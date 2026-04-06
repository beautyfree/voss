import { requireCredentials, api } from "../lib/credentials";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { bold, cyan, dim, green, red, yellow, icon, kv } from "../ui/style";

export default async function status(args: string[]) {
  const creds = requireCredentials();

  const configPath = join(process.cwd(), "voss.json");
  let projectName: string;

  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    projectName = config.name;
  } else {
    projectName = process.cwd().split("/").pop() ?? "app";
  }

  const resp = await api(creds, `/api/projects/${projectName}`);

  if (!resp.ok) {
    if (resp.status === 404) {
      console.log();
      console.log(`  ${dim("Project")} ${bold(projectName)} ${dim("not deployed yet.")}`);
      console.log(`  Run: ${cyan("voss deploy")}`);
      console.log();
      return;
    }
    const err = await resp.json();
    console.error(`  ${icon.error} ${(err as any).message}`);
    process.exit(1);
  }

  const { data } = await resp.json() as any;

  console.log();
  kv("Project", bold(data.name));
  kv("Framework", cyan(data.framework));
  kv("Domain", data.domain ?? dim("not set"));

  if (data.latestDeployment) {
    const d = data.latestDeployment;
    const statusText = d.status === "live"
      ? `${icon.live} ${green("live")}`
      : d.status === "failed"
        ? `${icon.error} ${red("failed")}`
        : `${icon.building} ${yellow(d.status)}`;
    kv("Status", statusText);
    kv("Deployed", dim(timeAgo(d.createdAt)));
    if (d.branch) kv("Branch", d.branch);
  }
  console.log();
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
