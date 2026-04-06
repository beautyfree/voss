import { createHash } from "crypto";
import { readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { existsSync, readFileSync } from "fs";
import { requireCredentials, api } from "../lib/credentials";
import { detectFramework, parseConfig, RUNNERS, type VossConfig } from "@voss/shared";
import { bold, cyan, dim, green, red, yellow, icon, elapsed, Spinner, kv } from "../ui/style";

export default async function deploy(args: string[]) {
  const verbose = args.includes("--verbose") || args.includes("-v");
  const creds = requireCredentials();
  const projectDir = process.cwd();
  const deployStart = Date.now();

  // 1. Load or detect config
  const config = await loadConfig(projectDir);
  const framework = config.framework ?? detectFramework(await listFiles(projectDir));
  config.framework = framework;
  const runner = RUNNERS[framework];

  console.log();
  console.log(`  Detected: ${cyan(framework)} ${dim(`(${runner.detectFiles[0] ?? "package.json"})`)}`);

  // 2. Hash files for dedup
  const spinner = new Spinner("Hashing files...");
  spinner.start();
  const files = await listFiles(projectDir);
  const manifest: Record<string, string> = {};

  for (const file of files) {
    const fullPath = join(projectDir, file);
    const content = await Bun.file(fullPath).arrayBuffer();
    const hash = createHash("sha256").update(new Uint8Array(content)).digest("hex");
    manifest[file] = hash;
  }

  // 3. Send manifest, get missing files
  spinner.stop();
  const manifestResp = await api(creds, "/api/deploy/manifest", {
    method: "POST",
    body: JSON.stringify({
      projectName: config.name,
      files: manifest,
      framework,
    }),
  });

  const manifestResult = await manifestResp.json() as any;

  if (!manifestResp.ok) {
    console.error(`  ${icon.error} ${manifestResult.message ?? "Manifest upload failed"}`);
    process.exit(1);
  }

  const { missing } = manifestResult.data;

  // 4. Upload changed files as tar
  const changedCount = missing.length;
  const totalCount = Object.keys(manifest).length;
  const cachedCount = totalCount - changedCount;
  console.log(`  Uploading: ${bold(String(totalCount))} files ${dim(`(${changedCount} changed, ${cachedCount} cached)`)}`);

  // Create tar of all files using file list (avoids arg length limits)
  const fileListPath = join(projectDir, ".voss-files.txt");
  await Bun.write(fileListPath, files.join("\n"));

  if (verbose) console.log(`    tar: ${files.length} files from ${projectDir}`);

  const tarProc = Bun.spawn(
    ["tar", "czf", "-", "-T", ".voss-files.txt"],
    { cwd: projectDir, stdout: "pipe", stderr: "pipe" }
  );
  const tarBlob = await new Response(tarProc.stdout).blob();
  const tarStderr = await new Response(tarProc.stderr).text();
  await tarProc.exited;

  // Cleanup file list
  try { await Bun.file(fileListPath).delete(); } catch {}

  if (tarProc.exitCode !== 0) {
    console.error(`  ${icon.error} tar failed: ${tarStderr}`);
    process.exit(1);
  }

  if (verbose) console.log(`    tar size: ${(tarBlob.size / 1024).toFixed(0)}KB`);

  const uploadUrl = `/api/deploy/upload/${config.name}`;
  if (verbose) console.log(`    POST ${creds.serverUrl}${uploadUrl}`);

  let uploadResp: Response;
  try {
    uploadResp = await api(creds, uploadUrl, {
      method: "POST",
      body: tarBlob,
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch (err) {
    console.error(`  ${icon.error} Upload failed: ${(err as Error).message}`);
    if (verbose) console.error(`    ${err}`);
    process.exit(1);
  }

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    console.error(`  ${icon.error} Upload failed ${dim(`(${uploadResp.status})`)}: ${errText}`);
    process.exit(1);
  }

  // 5. Start deploy
  let buildSpinner = new Spinner("Building...");
  const deployResp = await api(creds, "/api/deploy/start", {
    method: "POST",
    body: JSON.stringify({ projectName: config.name, config }),
  });

  const deployResult = await deployResp.json() as any;

  if (!deployResp.ok) {
    console.error(`  ${icon.error} Deploy failed: ${deployResult.message ?? "Unknown error"}`);
    process.exit(1);
  }

  const deploy = deployResult.data;
  buildSpinner.start();

  // 6. Stream logs via WebSocket, fall back to polling
  const wsUrl = creds.serverUrl.replace("https://", "wss://").replace("http://", "ws://");
  const wsEndpoint = `${wsUrl}/ws/logs/${deploy.deploymentId}`;

  let resolved = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsEndpoint);
      const timeout = setTimeout(() => {
        if (!resolved) {
          ws.close();
          reject(new Error("timeout"));
        }
      }, 600_000); // 10 min max

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "log") {
            buildSpinner.stop();
            console.log(`    ${dim(">")} ${msg.data}`);
          } else if (msg.type === "status") {
            if (msg.status === "building") {
              buildSpinner.update("Building...");
            } else if (msg.status === "health_checking") {
              buildSpinner.stop();
              buildSpinner = new Spinner("Health check...");
              buildSpinner.start();
            } else if (msg.status === "live") {
              buildSpinner.stop();
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              resolve();
            } else if (msg.status === "failed") {
              buildSpinner.stop();
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              reject(new Error("failed"));
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          buildSpinner.stop();
          ws.close();
          reject(new Error("ws_error"));
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          reject(new Error("ws_closed"));
        }
      };
    });

    // Success
    const domain = config.name; // TODO: show real domain if configured
    console.log(`  ${icon.success} Health check passed ${elapsed(deployStart)}`);
    console.log();
    console.log(`  ${icon.success} ${bold("Deployed")} ${icon.arrow} ${cyan(`https://${domain}`)}`);
    console.log();
  } catch (err) {
    const msg = (err as Error).message;

    if (msg === "failed") {
      buildSpinner.stop();
      console.error(`  ${icon.error} ${red("Deploy failed")}`);
      console.error(`    ${dim("Full log:")} voss logs --deploy ${deploy.deploymentId}`);
      process.exit(1);
    }

    // WebSocket failed, fall back to polling
    if (msg === "ws_error" || msg === "ws_closed") {
      buildSpinner.stop();
      const pollSpinner = new Spinner("Deploying...");
      pollSpinner.start();

      let lastStatus = "";
      while (true) {
        const statusResp = await api(creds, `/api/deployments/${deploy.deploymentId}`);
        const { data: d } = await statusResp.json() as any;

        if (d.status !== lastStatus) {
          lastStatus = d.status;
          if (d.status === "building") pollSpinner.update("Building...");
          if (d.status === "health_checking") pollSpinner.update("Health check...");
          if (d.status === "live") {
            pollSpinner.stop();
            console.log(`  ${icon.success} Health check passed ${elapsed(deployStart)}`);
            console.log();
            console.log(`  ${icon.success} ${bold("Deployed")} ${icon.arrow} ${cyan(`https://${config.name}`)}`);
            console.log();
            return;
          }
          if (d.status === "failed") {
            pollSpinner.stop();
            console.error(`  ${icon.error} ${red("Deploy failed")}`);
            console.error(`    ${dim("Full log:")} voss logs --deploy ${deploy.deploymentId}`);
            process.exit(1);
          }
        }
        await Bun.sleep(2000);
      }
    }
  }
}

async function loadConfig(dir: string): Promise<VossConfig> {
  const configPath = join(dir, "voss.json");
  if (existsSync(configPath)) {
    const raw = JSON.parse(await Bun.file(configPath).text());
    return parseConfig(raw);
  }

  // Infer name from directory
  const name = dir.split("/").pop() ?? "app";
  return { name };
}

async function listFiles(dir: string): Promise<string[]> {
  const ignorePatterns = [
    "node_modules",
    ".git",
    ".voss",
    ".turbo",
    ".cache",
    ".vercel",
    ".svelte-kit",
    "dist",
    ".next",
    ".nuxt",
    ".output",
    ".env",
    ".env.local",
    ".env.production",
    ".DS_Store",
    "coverage",
    ".nyc_output",
  ];

  // Load .gitignore patterns
  const gitignorePath = join(dir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        // Strip trailing slash for directory patterns
        ignorePatterns.push(trimmed.replace(/\/$/, ""));
      }
    }
  }

  // Load .vossignore patterns (overrides)
  const vossignorePath = join(dir, ".vossignore");
  if (existsSync(vossignorePath)) {
    const content = readFileSync(vossignorePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        ignorePatterns.push(trimmed.replace(/\/$/, ""));
      }
    }
  }

  const files: string[] = [];

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      if (ignorePatterns.some((p) => name === p || name.startsWith("." + p))) continue;

      const fullPath = join(current, name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(relative(dir, fullPath));
      }
    }
  }

  await walk(dir);
  return files;
}
