import { Elysia, t } from "elysia";
import { eq, desc } from "drizzle-orm";
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
    const { projectName, files, framework } = body as {
      projectName: string;
      files: Record<string, string>;
      framework?: string;
    };

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
  })

  // Upload files (SHA dedup step 2 — tar of changed files)
  .post("/deploy/upload/:projectName", async ({ params, body }) => {
    const uploadDir = `${VOSS_UPLOADS_DIR}/${params.projectName}`;
    await mkdir(uploadDir, { recursive: true });

    // body is the tar file
    const tarPath = `${uploadDir}/_upload.tar.gz`;
    await Bun.write(tarPath, body as Blob);

    // Extract
    const proc = Bun.spawn(["tar", "xzf", tarPath, "-C", uploadDir]);
    await proc.exited;

    // Cleanup tar
    await Bun.file(tarPath).delete();

    return { data: { uploaded: true, dir: uploadDir } };
  })

  // Trigger deploy
  .post("/deploy/start", async ({ body }) => {
    const { projectName, config: rawConfig } = body as {
      projectName: string;
      config: VossConfig;
    };

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
    const logPath = `${VOSS_LOG_DIR}/${projectName}/${deploymentId}.log`;
    db.insert(schema.deployments)
      .values({
        id: deploymentId,
        projectId: project.id,
        status: "queued",
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
    deployInBackground(deploymentId, projectName, project.id, config, envMap);

    return {
      data: {
        deploymentId,
        projectName,
        framework,
        status: "queued" as DeploymentStatus,
      },
    };
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

    return { data: { rolledBackTo: alias.previousDeploymentId } };
  });

// ── Background deploy ──

async function deployInBackground(
  deploymentId: string,
  projectName: string,
  projectId: string,
  config: VossConfig,
  envVars: Record<string, string>,
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
    const hcTimeout = (config.healthCheck?.timeout ?? 60) * 1000;
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

    // Success — update alias
    const existingAlias = db
      .select()
      .from(schema.aliases)
      .where(eq(schema.aliases.projectId, projectId))
      .get();

    if (existingAlias) {
      // Stop old container after drain period (30s)
      const oldDeployment = db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.id, existingAlias.deploymentId))
        .get();

      db.update(schema.aliases)
        .set({
          deploymentId,
          previousDeploymentId: existingAlias.deploymentId,
        })
        .where(eq(schema.aliases.id, existingAlias.id))
        .run();

      // Drain + stop old container
      if (oldDeployment?.containerName) {
        setTimeout(async () => {
          await stopContainer(oldDeployment.containerName!);
        }, 30_000);
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

    // Update Traefik routing
    const projectDomains = db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.projectId, projectId))
      .all();

    await updateTraefikConfig({
      projectName,
      containerName,
      port: RUNNERS[framework].port,
      domains: projectDomains.map((d) => d.hostname),
    });

    broadcastLog(deploymentId, `✓ https://${projectName}.${process.env.VOSS_DOMAIN ?? "yourdomain.com"}`);
    updateStatus(deploymentId, "live");
    db.update(schema.deployments)
      .set({ finishedAt: new Date().toISOString() })
      .where(eq(schema.deployments.id, deploymentId))
      .run();
  } catch (err) {
    updateStatus(deploymentId, "failed");
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
