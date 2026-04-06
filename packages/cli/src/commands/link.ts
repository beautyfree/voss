import { requireCredentials, api } from "../lib/credentials";
import { icon, header, kv, green, red, dim, Spinner } from "../ui/style";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export default async function link(args: string[]) {
  const creds = requireCredentials();
  const dir = process.cwd();

  // Get project name from voss.json
  const configPath = join(dir, "voss.json");
  if (!existsSync(configPath)) {
    console.error(`  ${icon.error} No voss.json found. Run: voss init`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const projectName = config.name;

  // Get repo URL from arg or git remote
  let repoUrl = args[0];
  if (!repoUrl) {
    try {
      const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      const output = await new Response(proc.stdout).text();
      repoUrl = output.trim()
        .replace(/\.git$/, "")
        .replace(/^git@github\.com:/, "https://github.com/");
    } catch {}
  }

  if (!repoUrl) {
    console.error(`  ${icon.error} Could not detect repo URL. Pass it explicitly: voss link https://github.com/user/repo`);
    process.exit(1);
  }

  header("Link repository");
  kv("Project", projectName);
  kv("Repository", repoUrl);

  const spinner = new Spinner("Linking...");
  spinner.start();

  const resp = await api(creds, `/api/projects/${projectName}`, {
    method: "PATCH",
    body: JSON.stringify({ repoUrl }),
  });

  if (!resp.ok) {
    spinner.stop(`  ${icon.error} ${red("Failed to link repository")}`);
    const body = await resp.json().catch(() => ({}));
    console.error(`  ${dim((body as any).message ?? `HTTP ${resp.status}`)}`);
    process.exit(1);
  }

  spinner.stop(`  ${icon.success} ${green("Repository linked")}`);
  console.log();
  console.log(`  GitHub webhooks will now auto-deploy pushes to ${dim(projectName)}`);
  console.log(`  Setup: ${dim(`${repoUrl}/settings/hooks`)}`);
  console.log(`    URL: ${dim(`${creds.serverUrl}/api/webhook/github`)}`);
  console.log(`    Secret: ${dim("(your VOSS_API_KEY)")}`);
  console.log(`    Events: ${dim("push, pull_request")}`);
}
