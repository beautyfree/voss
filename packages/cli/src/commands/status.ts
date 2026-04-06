import { requireCredentials, api } from "../lib/credentials";
import { existsSync } from "fs";
import { join } from "path";

export default async function status(args: string[]) {
  const creds = requireCredentials();

  // Get project name from voss.json or directory name
  const configPath = join(process.cwd(), "voss.json");
  let projectName: string;

  if (existsSync(configPath)) {
    const config = JSON.parse(await Bun.file(configPath).text());
    projectName = config.name;
  } else {
    projectName = process.cwd().split("/").pop() ?? "app";
  }

  const resp = await api(creds, `/api/projects/${projectName}`);

  if (!resp.ok) {
    if (resp.status === 404) {
      console.log(`  Project '${projectName}' not deployed yet.`);
      console.log("  Run: voss deploy");
      return;
    }
    const err = await resp.json();
    console.error(`  ✕ ${(err as any).message}`);
    process.exit(1);
  }

  const { data } = await resp.json() as any;

  console.log(`  Project:   ${data.name}`);
  console.log(`  Framework: ${data.framework}`);
  console.log(`  Domain:    ${data.domain ?? "not set"}`);

  if (data.latestDeployment) {
    const d = data.latestDeployment;
    const status = d.status === "live" ? "● live" : d.status === "failed" ? "✕ failed" : `○ ${d.status}`;
    const ago = timeAgo(d.createdAt);
    console.log(`  Status:    ${status}`);
    console.log(`  Deployed:  ${ago}`);
    if (d.branch) console.log(`  Branch:    ${d.branch}`);
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
