import { Elysia, t } from "elysia";
import { eq, desc, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import { runContainer, healthCheck, stopContainer, streamLogs } from "../services/runner";
import {
  RUNNERS,
  VOSS_UPLOADS_DIR,
  VOSS_LOG_DIR,
  HEALTH_CHECK_DEFAULT_PATH,
  HEALTH_CHECK_DEFAULT_TIMEOUT,
  CONTAINER_KEEP_COUNT,
  detectFramework,
  parseConfig,
  type VossConfig,
  type DeploymentStatus,
} from "@voss/shared";
import { updateTraefikConfig } from "../services/traefik";
import { createHash } from "crypto";
import { readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { logEvent } from "../services/events";
import { notifyDeploy } from "../services/notify";
import { postPreviewComment } from "../services/github";

// ── WebSocket log subscribers ──
const logSubscribers = new Map<string, Set<(msg: string) => void>>();

export function subscribeToLogs(deploymentId: string, cb: (msg: string) => void) {
  if (!logSubscribers.has(deploymentId)) {
    logSubscribers.set(deploymentId, new Set());
  }
  logSubscribers.get(deploymentId)!.add(cb);
  return () => logSubscribers.get(deploymentId)?.delete(cb);
}

function broadcastLog(deploymentId: string, msg: string) {
  const subs = logSubscribers.get(deploymentId);
  if (subs) {
    for (const cb of subs) cb(msg);
  }
}

// Simple in-memory build queue
let building = false;
const queue: (() => void)[] = [];

async function acquireBuildSlot(): Promise<void> {
  if (!building) {
    building = true;
    return;
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseBuildSlot() {
  building = false;
  const next = queue.shift();
  if (next) {
    building = true;
    next();
  }
}

export const deployRoutes = new Elysia({ prefix: "/api" })
  // Upload file manifest (SHA dedup step 1)
  .post("/deploy/manifest", async ({ body }) => {
    const { projectName, files, framework } = body;

    // Check which files we already have
    const uploadDir = `${VOSS_UPLOADS_DIR}/${projectName}`;
    const missing: string[] = [];

    for (const [path, hash] of Object.entries(files)) {
      const hashDir = `${VOSS_UPLOADS_DIR}/.cache/${hash}`;
      if (!existsSync(hashDir)) {
        missing.push(hash);
      }
    }

    return { data: { missing, uploadDir } };
  }, {
    body: t.Object({
      projectName: t.String(),
      files: t.Record(t.String(), t.String()),
      framework: t.Optional(t.String()),
    }),
  })

  // Upload files (SHA dedup step 2 — tar of changed files)
  .post("/deploy/upload/:name", async ({ params, body }) => {
    const uploadDir = `${VOSS_UPLOADS_DIR}/${params.name}`;
    await mkdir(uploadDir, { recursive: true });

    const tarPath = `${uploadDir}/_upload.tar.gz`;
    // body is ArrayBuffer when parse type is set correctly
    await Bun.write(tarPath, body as ArrayBuffer);

    // Extract
    const proc = Bun.spawn(["tar", "xzf", tarPath, "-C", uploadDir]);
    await proc.exited;

    // Cleanup tar
    await Bun.file(tarPath).delete();

    return { data: { uploaded: true, dir: uploadDir } };
  }, {
    parse: "arrayBuffer",
  })

  // Trigger deploy
  .post("/deploy/start", async ({ body }) => {
    const { projectName, config: rawConfig, preview, branch } = body;

    const db = getDb();
    const config = parseConfig(rawConfig);
    const framework = config.framework ?? "unknown";
    const runner = RUNNERS[framework];
    const deploymentId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create or get project
    let project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, projectName))
      .get();

    if (!project) {
      const projectId = crypto.randomUUID();
      db.insert(schema.projects)
        .values({
          id: projectId,
          name: projectName,
          framework,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()!;
    }

    // Get env vars for snapshot
    const envVars = db
      .select()
      .from(schema.envVars)
      .where(eq(schema.envVars.projectId, project.id))
      .all();

    const envMap: Record<string, string> = {};
    for (const v of envVars) {
      envMap[v.key] = v.value;
    }

    // Create deployment record
    const isPreview = preview ?? false;
    const branchName = branch ?? "main";
    const logPath = `${VOSS_LOG_DIR}/${projectName}/${deploymentId}.log`;
    db.insert(schema.deployments)
      .values({
        id: deploymentId,
        projectId: project.id,
        status: "queued",
        branch: branchName,
        runnerImage: runner.image,
        buildCommand: config.buildCommand ?? runner.buildCommand,
        startCommand: config.startCommand ?? runner.startCommand,
        logPath,
        envVarsSnapshot: JSON.stringify(envMap),
        configSnapshot: JSON.stringify(config),
        createdAt: now,
      })
      .run();

    // Run deploy in background
    deployInBackground(deploymentId, projectName, project.id, config, envMap, isPreview, branchName);

    return {
      data: {
        deploymentId,
        projectName,
        framework,
        status: "queued" as DeploymentStatus,
      },
    };
  }, {
    body: t.Object({
      projectName: t.String(),
      config: t.Any(),
      preview: t.Optional(t.Boolean()),
      branch: t.Optional(t.String()),
    }),
  })

  // Get deployment logs (saved file)
  .get("/deployments/:id/logs", async ({ params }) => {
    const db = getDb();
    const deployment = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.id, params.id))
      .get();

    if (!deployment) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Deployment not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!deployment.logPath || !existsSync(deployment.logPath)) {
      return { data: ["[no logs available]"] };
    }

    const content = await Bun.file(deployment.logPath).text();
    const lines = content.split("\n").filter(Boolean);
    return { data: lines };
  })

  // Get deployment status
  .get("/deployments/:id", ({ params }) => {
    const db = getDb();
    const deployment = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.id, params.id))
      .get();

    if (!deployment) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Deployment not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return { data: deployment };
  })

  // List deployments for a project
  .get("/projects/:name/deployments", ({ params }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Project not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const deploys = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id))
      .orderBy(desc(schema.deployments.createdAt))
      .limit(20)
      .all();

    return { data: deploys };
  })

  // Redeploy — re-run last deployment with same config
  .post("/projects/:name/redeploy", async ({ params }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Project not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Find last deployment to get config
    const lastDeploy = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id))
      .orderBy(desc(schema.deployments.createdAt))
      .limit(1)
      .get();

    if (!lastDeploy) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "No previous deployment to redeploy" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const config = JSON.parse(lastDeploy.configSnapshot || "{}") as VossConfig;
    const framework = config.framework ?? project.framework ?? "unknown";
    const runner = RUNNERS[framework];
    const deploymentId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Get current env vars
    const envVarRows = db
      .select()
      .from(schema.envVars)
      .where(eq(schema.envVars.projectId, project.id))
      .all();
    const envMap: Record<string, string> = {};
    for (const v of envVarRows) envMap[v.key] = v.value;

    const branchName = lastDeploy.branch ?? "main";
    const logPath = `${VOSS_LOG_DIR}/${project.name}/${deploymentId}.log`;

    db.insert(schema.deployments)
      .values({
        id: deploymentId,
        projectId: project.id,
        status: "queued",
        branch: branchName,
        commitSha: lastDeploy.commitSha,
        runnerImage: runner.image,
        buildCommand: config.buildCommand ?? runner.buildCommand,
        startCommand: config.startCommand ?? runner.startCommand,
        logPath,
        envVarsSnapshot: JSON.stringify(envMap),
        configSnapshot: JSON.stringify(config),
        createdAt: now,
      })
      .run();

    deployInBackground(deploymentId, project.name, project.id, config, envMap, false, branchName);

    return {
      data: {
        deploymentId,
        projectName: project.name,
        framework,
        status: "queued" as DeploymentStatus,
      },
    };
  })

  // Rollback
  .post("/projects/:name/rollback", async ({ params }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Project not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const alias = db
      .select()
      .from(schema.aliases)
      .where(eq(schema.aliases.projectId, project.id))
      .get();

    if (!alias?.previousDeploymentId) {
      return new Response(
        JSON.stringify({
          code: "NOT_FOUND",
          message: "No previous deployment to rollback to",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Swap alias
    const oldDeploymentId = alias.deploymentId;
    db.update(schema.aliases)
      .set({
        deploymentId: alias.previousDeploymentId,
        previousDeploymentId: oldDeploymentId,
      })
      .where(eq(schema.aliases.id, alias.id))
      .run();

    // Update deployment statuses
    db.update(schema.deployments)
      .set({ status: "rolled_back" })
      .where(eq(schema.deployments.id, oldDeploymentId))
      .run();
    db.update(schema.deployments)
      .set({ status: "live" })
      .where(eq(schema.deployments.id, alias.previousDeploymentId))
      .run();

    // TODO: regenerate Traefik config to point to rolled-back container
    logEvent(project.id, "rollback", `Rolled back ${project.name}`, { from: oldDeploymentId, to: alias.previousDeploymentId });

    return { data: { rolledBackTo: alias.previousDeploymentId } };
  });

// ── Background deploy ──

export async function deployInBackground(
  deploymentId: string,
  projectName: string,
  projectId: string,
  config: VossConfig,
  envVars: Record<string, string>,
  isPreview: boolean = false,
  branchName: string = "main",
  prNumber?: number,
) {
  const db = getDb();
  const framework = config.framework ?? "unknown";

  try {
    // Wait for build slot
    await acquireBuildSlot();
    updateStatus(deploymentId, "building");
    broadcastLog(deploymentId, `Building ${projectName} (${framework})...`);

    const uploadDir = `${VOSS_UPLOADS_DIR}/${projectName}`;

    // Start container
    updateStatus(deploymentId, "deploying");
    broadcastLog(deploymentId, "Starting container...");
    const { containerId, containerName } = await runContainer({
      projectName,
      deploymentId,
      framework,
      config,
      envVars,
      uploadDir,
    });

    // Update deployment with container info
    db.update(schema.deployments)
      .set({ containerId, containerName })
      .where(eq(schema.deployments.id, deploymentId))
      .run();

    // Stream logs
    const logPath = `${VOSS_LOG_DIR}/${projectName}/${deploymentId}.log`;
    streamLogs(containerName, logPath);

    // Health check
    updateStatus(deploymentId, "health_checking");
    broadcastLog(deploymentId, "Running health check...");
    const hcPath = config.healthCheck?.path ?? HEALTH_CHECK_DEFAULT_PATH;
    const hcTimeout = (config.healthCheck?.timeout ?? 300) * 1000;
    const healthy = await healthCheck(containerName, hcPath, hcTimeout);

    if (!healthy) {
      updateStatus(deploymentId, "failed");
      broadcastLog(deploymentId, `✕ Health check failed (${hcTimeout / 1000}s timeout)`);
      broadcastLog(deploymentId, `  Your app didn't respond on ${hcPath}`);
      broadcastLog(deploymentId, `  Fix: Check start command or increase healthCheck.timeout in voss.json`);
      await stopContainer(containerName);
      releaseBuildSlot();
      return;
    }

    broadcastLog(deploymentId, "Health check: ● passed");

    // Success — update alias (production or preview)
    const aliasType = isPreview ? "preview" : "production";
    const aliasSubdomain = isPreview
      ? `${branchName.replace(/[^a-z0-9-]/gi, "-")}-${projectName}`
      : projectName;

    if (isPreview) {
      // Preview: create new alias, don't touch production
      const existingPreview = db
        .select()
        .from(schema.aliases)
        .where(
          and(
            eq(schema.aliases.projectId, projectId),
            eq(schema.aliases.subdomain, aliasSubdomain)
          )
        )
        .get();

      if (existingPreview) {
        const oldDeploy = db.select().from(schema.deployments)
          .where(eq(schema.deployments.id, existingPreview.deploymentId)).get();
        db.update(schema.aliases)
          .set({ deploymentId, previousDeploymentId: existingPreview.deploymentId })
          .where(eq(schema.aliases.id, existingPreview.id))
          .run();
        if (oldDeploy?.containerName) {
          setTimeout(() => stopContainer(oldDeploy.containerName!), 30_000);
        }
      } else {
        db.insert(schema.aliases)
          .values({
            id: crypto.randomUUID(),
            projectId,
            subdomain: aliasSubdomain,
            deploymentId,
            previousDeploymentId: null,
            type: "preview",
          })
          .run();
      }
    } else {
      // Production: swap alias
      const existingAlias = db
        .select()
        .from(schema.aliases)
        .where(
          and(
            eq(schema.aliases.projectId, projectId),
            eq(schema.aliases.type, "production")
          )
        )
        .get();

      if (existingAlias) {
        const oldDeployment = db.select().from(schema.deployments)
          .where(eq(schema.deployments.id, existingAlias.deploymentId)).get();
        db.update(schema.aliases)
          .set({ deploymentId, previousDeploymentId: existingAlias.deploymentId })
          .where(eq(schema.aliases.id, existingAlias.id))
          .run();
        if (oldDeployment?.containerName) {
          setTimeout(() => stopContainer(oldDeployment.containerName!), 30_000);
        }
      } else {
        db.insert(schema.aliases)
          .values({
            id: crypto.randomUUID(),
            projectId,
            subdomain: projectName,
            deploymentId,
            previousDeploymentId: null,
            type: "production",
          })
          .run();
      }
    }

    // Update Traefik routing
    const projectDomains = db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.projectId, projectId))
      .all();

    // For preview: add preview subdomain as a domain
    const previewDomain = isPreview
      ? [`${aliasSubdomain}.${process.env.VOSS_DOMAIN ?? "localhost"}`]
      : [];

    await updateTraefikConfig({
      projectName: isPreview ? aliasSubdomain : projectName,
      containerName,
      port: RUNNERS[framework].port,
      domains: [...projectDomains.map((d) => d.hostname), ...previewDomain],
    });

    broadcastLog(deploymentId, `✓ https://${projectName}.${process.env.VOSS_DOMAIN ?? "yourdomain.com"}`);
    updateStatus(deploymentId, "live");
    db.update(schema.deployments)
      .set({ finishedAt: new Date().toISOString() })
      .where(eq(schema.deployments.id, deploymentId))
      .run();
    const deployUrl = `https://${isPreview ? aliasSubdomain : projectName}.${process.env.VOSS_DOMAIN ?? "yourdomain.com"}`;
    logEvent(projectId, "deploy", `Deployed ${projectName} (${framework}) — ${isPreview ? "preview" : "production"}`, { deploymentId, branch: branchName });
    notifyDeploy(projectId, "live", { projectName, deploymentId, branch: branchName, url: deployUrl });
    if (isPreview && prNumber) {
      postPreviewComment(projectId, prNumber, deployUrl, deploymentId, "live");
    }
  } catch (err) {
    updateStatus(deploymentId, "failed");
    logEvent(projectId, "deploy_failed", `Deploy failed: ${(err as Error).message}`, { deploymentId });
    notifyDeploy(projectId, "failed", { projectName, deploymentId, branch: branchName });
    if (isPreview && prNumber) {
      postPreviewComment(projectId, prNumber, "", deploymentId, "failed");
    }
    console.error(`Deploy ${deploymentId} failed:`, err);
  } finally {
    releaseBuildSlot();
  }
}

function updateStatus(deploymentId: string, status: DeploymentStatus) {
  const db = getDb();
  db.update(schema.deployments)
    .set({ status })
    .where(eq(schema.deployments.id, deploymentId))
    .run();

  // Broadcast status change to WebSocket subscribers
  const subs = logSubscribers.get(deploymentId);
  if (subs) {
    const msg = JSON.stringify({ type: "status", status });
    for (const cb of subs) cb(msg);
  }
}
