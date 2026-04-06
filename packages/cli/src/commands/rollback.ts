import { requireCredentials, api } from "../lib/credentials";
import { existsSync } from "fs";
import { join } from "path";

export default async function rollback(args: string[]) {
  const creds = requireCredentials();

  const configPath = join(process.cwd(), "voss.json");
  let projectName: string;

  if (existsSync(configPath)) {
    const config = JSON.parse(await Bun.file(configPath).text());
    projectName = config.name;
  } else {
    projectName = process.cwd().split("/").pop() ?? "app";
  }

  console.log(`  Rolling back ${projectName}...`);

  const resp = await api(creds, `/api/projects/${projectName}/rollback`, {
    method: "POST",
  });

  if (!resp.ok) {
    const err = await resp.json() as any;
    if (err.code === "NOT_FOUND" && err.message?.includes("No previous")) {
      console.error("  ✕ No previous deployment to rollback to");
    } else {
      console.error(`  ✕ Rollback failed: ${err.message}`);
    }
    process.exit(1);
  }

  const { data } = await resp.json() as any;
  console.log(`  ✓ Rolled back to deployment ${data.rolledBackTo.slice(0, 8)}`);
}
