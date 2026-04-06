import { getDb, schema } from "../db";
import { eq } from "drizzle-orm";

/**
 * Post a comment on a GitHub PR with the preview deploy URL.
 * Requires GITHUB_TOKEN env var with repo permissions.
 */
export async function postPreviewComment(
  projectId: string,
  prNumber: number,
  previewUrl: string,
  deploymentId: string,
  status: "live" | "failed",
) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  const db = getDb();
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  if (!project?.repoUrl) return;

  // Extract owner/repo from URL
  const match = project.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return;
  const repo = match[1];

  const emoji = status === "live" ? "✅" : "❌";
  const body = status === "live"
    ? `${emoji} **Preview deployed**\n\n🔗 ${previewUrl}\n\n<sub>Deploy: \`${deploymentId.slice(0, 8)}\` · Powered by voss</sub>`
    : `${emoji} **Preview deploy failed**\n\n<sub>Deploy: \`${deploymentId.slice(0, 8)}\` · Check logs in dashboard</sub>`;

  try {
    await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`[github] Posted preview comment on ${repo}#${prNumber}`);
  } catch (err) {
    console.error(`[github] Failed to post comment:`, (err as Error).message);
  }
}
