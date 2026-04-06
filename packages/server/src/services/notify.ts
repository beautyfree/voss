import { getDb, schema } from "../db";
import { eq } from "drizzle-orm";

/**
 * Send deploy notification to project's webhook URL (Slack, Telegram, Discord, etc.)
 * Fires and forgets — never blocks deploy.
 */
export async function notifyDeploy(
  projectId: string,
  status: "live" | "failed",
  meta: { projectName: string; deploymentId: string; branch: string; url?: string },
) {
  const db = getDb();
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  if (!project?.notifyUrl) return;

  const emoji = status === "live" ? "✅" : "❌";
  const text = `${emoji} **${meta.projectName}** — ${status === "live" ? "deployed" : "deploy failed"}\nBranch: ${meta.branch}\n${meta.url ? `URL: ${meta.url}` : `Deploy: ${meta.deploymentId.slice(0, 8)}`}`;

  try {
    // Auto-detect webhook format
    const url = project.notifyUrl;
    let body: any;

    if (url.includes("hooks.slack.com")) {
      // Slack incoming webhook
      body = { text };
    } else if (url.includes("api.telegram.org")) {
      // Telegram bot API — URL format: https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>
      body = { text, parse_mode: "Markdown" };
    } else if (url.includes("discord.com/api/webhooks")) {
      // Discord webhook
      body = { content: text };
    } else {
      // Generic — send JSON payload
      body = {
        event: "deploy",
        status,
        project: meta.projectName,
        deployment: meta.deploymentId,
        branch: meta.branch,
        url: meta.url,
        text,
      };
    }

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error(`[notify] Failed to send to ${project.notifyUrl}:`, (err as Error).message);
  }
}
