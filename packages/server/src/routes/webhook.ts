import { Elysia } from "elysia";
import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
  RUNNERS,
  VOSS_UPLOADS_DIR,
  VOSS_LOG_DIR,
  parseConfig,
  type VossConfig,
  type DeploymentStatus,
} from "@voss/shared";
import { deployInBackground } from "./deploy";
import { stopContainer } from "../services/runner";
import { removeTraefikConfig } from "../services/traefik";

// GitHub webhook handler
// Setup: repo Settings → Webhooks → Add → URL: https://your-server:3456/api/webhook/github
// Secret: same as VOSS_API_KEY, Events: push + pull_request

const WEBHOOK_SECRET = process.env.VOSS_API_KEY ?? "";

export const webhookRoutes = new Elysia({ prefix: "/api/webhook" })
  // GitHub push/PR webhook — public endpoint (validated by secret)
  .post("/github", async ({ body, headers }) => {
    const event = headers["x-github-event"];
    const payload = body as any;

    // TODO: proper HMAC signature validation

    if (event === "push") {
      return handlePush(payload);
    }

    if (event === "pull_request") {
      return handlePullRequest(payload);
    }

    return { data: { ignored: true, event } };
  });

async function handlePush(payload: any) {
  const repoFullName = payload.repository?.full_name;
  const branch = payload.ref?.replace("refs/heads/", "");
  const commitSha = payload.after;

  if (!repoFullName || !branch) {
    return { data: { ignored: true, reason: "missing repo or branch" } };
  }

  const db = getDb();
  const projects = db.select().from(schema.projects).all();

  // Match by project name (TODO: add repo_url field for proper matching)
  const project = projects.find((p) => {
    const repoName = repoFullName.split("/").pop();
    return p.name === repoName;
  });

  if (!project) {
    return { data: { ignored: true, reason: `no project matches repo ${repoFullName}` } };
  }

  // Only auto-deploy on push to main/master
  const isMainBranch = branch === "main" || branch === "master";
  if (!isMainBranch) {
    return { data: { ignored: true, reason: `push to ${branch}, not main` } };
  }

  console.log(`[webhook] Push to ${repoFullName}/${branch} (${commitSha?.slice(0, 7)}) → triggering deploy`);

  // Get last deployment config to redeploy with
  const lastDeploy = db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.projectId, project.id))
    .orderBy(desc(schema.deployments.createdAt))
    .limit(1)
    .get();

  if (!lastDeploy) {
    return {
      data: {
        ignored: true,
        reason: "no previous deployment config — deploy via CLI first",
      },
    };
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

  const logPath = `${VOSS_LOG_DIR}/${project.name}/${deploymentId}.log`;

  db.insert(schema.deployments)
    .values({
      id: deploymentId,
      projectId: project.id,
      status: "queued",
      branch,
      commitSha,
      runnerImage: runner.image,
      buildCommand: config.buildCommand ?? runner.buildCommand,
      startCommand: config.startCommand ?? runner.startCommand,
      logPath,
      envVarsSnapshot: JSON.stringify(envMap),
      configSnapshot: JSON.stringify(config),
      createdAt: now,
    })
    .run();

  // Fire and forget — deploy runs in background
  deployInBackground(deploymentId, project.name, project.id, config, envMap, false, branch);

  return {
    data: {
      received: true,
      event: "push",
      repo: repoFullName,
      branch,
      commit: commitSha?.slice(0, 7),
      deploymentId,
      status: "queued",
    },
  };
}

async function handlePullRequest(payload: any) {
  const action = payload.action; // opened, synchronize, closed
  const prNumber = payload.number;
  const branch = payload.pull_request?.head?.ref;
  const repoFullName = payload.repository?.full_name;

  if (!repoFullName || !branch) {
    return { data: { ignored: true, reason: "missing repo or branch" } };
  }

  const db = getDb();
  const projects = db.select().from(schema.projects).all();
  const project = projects.find((p) => {
    const repoName = repoFullName.split("/").pop();
    return p.name === repoName;
  });

  if (!project) {
    return { data: { ignored: true, reason: `no project matches repo ${repoFullName}` } };
  }

  if (action === "closed") {
    console.log(`[webhook] PR #${prNumber} closed on ${repoFullName} → cleaning up preview`);

    // Find and cleanup preview alias for this branch
    const previewSubdomain = `${branch.replace(/[^a-z0-9-]/gi, "-")}-${project.name}`;
    const alias = db
      .select()
      .from(schema.aliases)
      .where(
        and(
          eq(schema.aliases.projectId, project.id),
          eq(schema.aliases.subdomain, previewSubdomain),
          eq(schema.aliases.type, "preview")
        )
      )
      .get();

    if (alias) {
      // Stop the container
      const deployment = db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.id, alias.deploymentId))
        .get();

      if (deployment?.containerName) {
        await stopContainer(deployment.containerName);
      }

      // Also stop previous if exists
      if (alias.previousDeploymentId) {
        const prevDeploy = db
          .select()
          .from(schema.deployments)
          .where(eq(schema.deployments.id, alias.previousDeploymentId))
          .get();
        if (prevDeploy?.containerName) {
          await stopContainer(prevDeploy.containerName);
        }
      }

      // Remove alias
      db.delete(schema.aliases)
        .where(eq(schema.aliases.id, alias.id))
        .run();

      // Remove Traefik config
      await removeTraefikConfig(previewSubdomain);

      return {
        data: {
          received: true,
          event: "pr_closed",
          pr: prNumber,
          cleaned: previewSubdomain,
        },
      };
    }

    return { data: { received: true, event: "pr_closed", pr: prNumber, cleaned: null } };
  }

  if (action === "opened" || action === "synchronize") {
    console.log(`[webhook] PR #${prNumber} ${action} on ${repoFullName} (${branch}) → triggering preview deploy`);

    // Get last deployment config
    const lastDeploy = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id))
      .orderBy(desc(schema.deployments.createdAt))
      .limit(1)
      .get();

    if (!lastDeploy) {
      return {
        data: {
          ignored: true,
          reason: "no previous deployment config — deploy via CLI first",
        },
      };
    }

    const config = JSON.parse(lastDeploy.configSnapshot || "{}") as VossConfig;
    const framework = config.framework ?? project.framework ?? "unknown";
    const runner = RUNNERS[framework];
    const deploymentId = crypto.randomUUID();
    const now = new Date().toISOString();
    const commitSha = payload.pull_request?.head?.sha;

    const envVarRows = db
      .select()
      .from(schema.envVars)
      .where(eq(schema.envVars.projectId, project.id))
      .all();
    const envMap: Record<string, string> = {};
    for (const v of envVarRows) envMap[v.key] = v.value;

    const logPath = `${VOSS_LOG_DIR}/${project.name}/${deploymentId}.log`;

    db.insert(schema.deployments)
      .values({
        id: deploymentId,
        projectId: project.id,
        status: "queued",
        branch,
        commitSha,
        runnerImage: runner.image,
        buildCommand: config.buildCommand ?? runner.buildCommand,
        startCommand: config.startCommand ?? runner.startCommand,
        logPath,
        envVarsSnapshot: JSON.stringify(envMap),
        configSnapshot: JSON.stringify(config),
        createdAt: now,
      })
      .run();

    deployInBackground(deploymentId, project.name, project.id, config, envMap, true, branch);

    return {
      data: {
        received: true,
        event: `pr_${action}`,
        pr: prNumber,
        branch,
        deploymentId,
        status: "queued",
      },
    };
  }

  return { data: { ignored: true, action } };
}
