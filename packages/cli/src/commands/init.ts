import { existsSync } from "fs";
import { join } from "path";
import { detectFramework, RUNNERS, PROJECT_TEMPLATES } from "@voss/shared";
import { readdir } from "fs/promises";

export default async function init(args: string[]) {
  const dir = process.cwd();
  const configPath = join(dir, "voss.json");

  if (existsSync(configPath)) {
    console.log("  voss.json already exists in this directory.");
    return;
  }

  // Check for --template flag
  const templateIdx = args.indexOf("--template");
  const templateId = templateIdx >= 0 ? args[templateIdx + 1] : undefined;

  if (templateId === "list" || args.includes("--list-templates")) {
    console.log("  Available templates:");
    for (const t of PROJECT_TEMPLATES) {
      const svc = t.services ? ` [${Object.keys(t.services).join(", ")}]` : "";
      console.log(`    ${t.id.padEnd(20)} ${t.name}${svc}`);
    }
    return;
  }

  const name = dir.split("/").pop() ?? "app";

  if (templateId) {
    const template = PROJECT_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      console.error(`  ✕ Unknown template: ${templateId}`);
      console.error(`  Run: voss init --template list`);
      process.exit(1);
    }

    const runner = RUNNERS[template.framework];
    const config: Record<string, any> = {
      name,
      framework: template.framework,
      buildCommand: runner.buildCommand,
      startCommand: runner.startCommand,
    };
    if (template.services) {
      config.services = template.services;
    }

    await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");

    const svcList = template.services ? Object.keys(template.services).join(", ") : "none";
    console.log(`  ✓ Created voss.json from template: ${template.name}`);
    console.log(`    Name:      ${name}`);
    console.log(`    Framework: ${template.framework}`);
    console.log(`    Services:  ${svcList}`);
    console.log();
    console.log("  Next: voss deploy");
    return;
  }

  // Default: auto-detect framework
  const entries = await readdir(dir);
  const framework = detectFramework(entries);
  const runner = RUNNERS[framework];

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
  console.log("  Tip: voss init --template list  (see available stacks)");
  console.log("  Next: voss deploy");
}
