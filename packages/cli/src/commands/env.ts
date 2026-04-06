import { requireCredentials, api } from "../lib/credentials";
import { existsSync } from "fs";
import { join } from "path";

export default async function env(args: string[]) {
  const creds = requireCredentials();
  const subcommand = args[0]; // set, get, or delete

  // Get project name
  const configPath = join(process.cwd(), "voss.json");
  let projectName: string;

  if (existsSync(configPath)) {
    const config = JSON.parse(await Bun.file(configPath).text());
    projectName = config.name;
  } else {
    projectName = process.cwd().split("/").pop() ?? "app";
  }

  if (!subcommand || subcommand === "get" || subcommand === "list") {
    // List env vars
    const resp = await api(creds, `/api/projects/${projectName}/env`);
    if (!resp.ok) {
      if ((await resp.json() as any).code === "NOT_FOUND") {
        console.log(`  No env vars. Set one: voss env set KEY=VALUE`);
        return;
      }
      console.error("  ✕ Could not fetch env vars");
      process.exit(1);
    }

    const { data: vars } = await resp.json() as any;

    if (!vars.length) {
      console.log(`  No env vars set. Run: voss env set KEY=VALUE`);
      return;
    }

    for (const v of vars) {
      const buildTag = v.isBuildTime ? " [build]" : "";
      console.log(`  ${v.key}=${v.value}${buildTag}`);
    }
    return;
  }

  if (subcommand === "set") {
    const pair = args[1];
    if (!pair || !pair.includes("=")) {
      console.error("  Usage: voss env set KEY=VALUE [--build]");
      process.exit(1);
    }

    const [key, ...valueParts] = pair.split("=");
    const value = valueParts.join("=");
    const isBuildTime = args.includes("--build");

    const resp = await api(creds, `/api/projects/${projectName}/env`, {
      method: "POST",
      body: JSON.stringify({ key, value, isBuildTime }),
    });

    if (!resp.ok) {
      console.error("  ✕ Could not set env var");
      process.exit(1);
    }

    const buildTag = isBuildTime ? " (build-time)" : "";
    console.log(`  ✓ Set ${key}${buildTag}`);
    return;
  }

  if (subcommand === "delete" || subcommand === "rm") {
    const key = args[1];
    if (!key) {
      console.error("  Usage: voss env delete KEY");
      process.exit(1);
    }

    const resp = await api(creds, `/api/projects/${projectName}/env/${key}`, {
      method: "DELETE",
    });

    if (!resp.ok) {
      console.error("  ✕ Could not delete env var");
      process.exit(1);
    }

    console.log(`  ✓ Deleted ${key}`);
    return;
  }

  console.error(`  Unknown env subcommand: ${subcommand}`);
  console.error("  Usage: voss env [get|set|delete]");
  process.exit(1);
}
