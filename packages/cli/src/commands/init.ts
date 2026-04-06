import { existsSync } from "fs";
import { join } from "path";
import { detectFramework, RUNNERS } from "@voss/shared";
import { readdir } from "fs/promises";

export default async function init(_args: string[]) {
  const dir = process.cwd();
  const configPath = join(dir, "voss.json");

  if (existsSync(configPath)) {
    console.log("  voss.json already exists in this directory.");
    return;
  }

  // Detect framework
  const entries = await readdir(dir);
  const framework = detectFramework(entries);
  const runner = RUNNERS[framework];
  const name = dir.split("/").pop() ?? "app";

  const config = {
    name,
    framework: framework !== "unknown" ? framework : undefined,
    buildCommand: runner.buildCommand,
    startCommand: runner.startCommand,
  };

  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");

  console.log(`  ✓ Created voss.json`);
  console.log(`    Name:      ${name}`);
  console.log(`    Framework: ${framework}`);
  console.log(`    Build:     ${runner.buildCommand}`);
  console.log(`    Start:     ${runner.startCommand}`);
  console.log();
  console.log("  Next: voss deploy");
}
