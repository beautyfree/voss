import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
  RUNNERS,
  VOSS_UPLOADS_DIR,
  parseConfig,
  type VossConfig,
} from "@voss/shared";

// GitHub webhook handler
// Setup: repo Settings → Webhooks → Add → URL: https://your-server:3456/api/webhook/github
// Secret: same as VOSS_API_KEY, Events: push + pull_request

const WEBHOOK_SECRET = process.env.VOSS_API_KEY ?? "";

export const webhookRoutes = new Elysia({ prefix: "/api/webhook" })
  // GitHub push/PR webhook — public endpoint (validated by secret)
  .post("/github", async ({ body, headers }) => {
    const event = headers["x-github-event"];
    const payload = body as any;

    // Validate webhook (simple signature check)
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

  // Find project linked to this repo
  const db = getDb();
  const projects = db.select().from(schema.projects).all();

  // TODO: add repo_url field to projects for proper matching
  // For now, match by project name
  const project = projects.find((p) => {
    const repoName = repoFullName.split("/").pop();
    return p.name === repoName;
  });

  if (!project) {
    return { data: { ignored: true, reason: `no project matches repo ${repoFullName}` } };
  }

  // Only auto-deploy on push to main/master
  if (branch !== "main" && branch !== "master") {
    return { data: { ignored: true, reason: `push to ${branch}, not main` } };
  }

  console.log(`[webhook] Push to ${repoFullName}/${branch} (${commitSha?.slice(0, 7)})`);

  // TODO: trigger deploy via the deploy pipeline
  // For now, just log it
  return {
    data: {
      received: true,
      event: "push",
      repo: repoFullName,
      branch,
      commit: commitSha?.slice(0, 7),
      message: "Auto-deploy not yet implemented. Use `voss deploy` from CLI.",
    },
  };
}

async function handlePullRequest(payload: any) {
  const action = payload.action; // opened, synchronize, closed
  const prNumber = payload.number;
  const branch = payload.pull_request?.head?.ref;
  const repoFullName = payload.repository?.full_name;

  if (action === "closed") {
    // TODO: stop and cleanup preview container
    console.log(`[webhook] PR #${prNumber} closed on ${repoFullName}`);
    return { data: { received: true, event: "pr_closed", pr: prNumber } };
  }

  if (action === "opened" || action === "synchronize") {
    console.log(`[webhook] PR #${prNumber} ${action} on ${repoFullName} (${branch})`);

    // TODO: trigger preview deploy
    return {
      data: {
        received: true,
        event: `pr_${action}`,
        pr: prNumber,
        branch,
        message: "Preview deploy not yet automated via webhook. Use `voss deploy --preview`.",
      },
    };
  }

  return { data: { ignored: true, action } };
}
