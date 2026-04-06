import { createHash } from "crypto";
import { readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { existsSync } from "fs";
import { requireCredentials, api } from "../lib/credentials";
import { detectFramework, parseConfig, RUNNERS, type VossConfig } from "@voss/shared";

export default async function deploy(args: string[]) {
  const creds = requireCredentials();
  const projectDir = process.cwd();

  // 1. Load or detect config
  const config = await loadConfig(projectDir);
  const framework = config.framework ?? detectFramework(await listFiles(projectDir));
  config.framework = framework;
  const runner = RUNNERS[framework];

  console.log(`  Detected: ${framework} (${runner.detectFiles[0] ?? "package.json"})`);

  // 2. Hash files for dedup
  console.log("  Hashing files...");
  const files = await listFiles(projectDir);
  const manifest: Record<string, string> = {};

  for (const file of files) {
    const fullPath = join(projectDir, file);
    const content = await Bun.file(fullPath).arrayBuffer();
    const hash = createHash("sha256").update(new Uint8Array(content)).digest("hex");
    manifest[file] = hash;
  }

  // 3. Send manifest, get missing files
  const manifestResp = await api(creds, "/api/deploy/manifest", {
    method: "POST",
    body: JSON.stringify({
      projectName: config.name,
      files: manifest,
      framework,
    }),
  });

  if (!manifestResp.ok) {
    const err = await manifestResp.json();
    console.error(`  ✕ ${(err as any).message}`);
    process.exit(1);
  }

  const { data: { missing } } = await manifestResp.json() as any;

  // 4. Upload changed files as tar
  const changedCount = missing.length;
  const totalCount = Object.keys(manifest).length;
  console.log(`  Uploading: ${totalCount} files (${changedCount} changed, ${totalCount - changedCount} cached)`);

  // Create tar of all files (for v0, send everything — dedup optimization later)
  const tarProc = Bun.spawn(
    ["tar", "czf", "-", ...files],
    { cwd: projectDir, stdout: "pipe" }
  );
  const tarBlob = await new Response(tarProc.stdout).blob();
  await tarProc.exited;

  const uploadResp = await api(creds, `/api/deploy/upload/${config.name}`, {
    method: "POST",
    body: tarBlob,
    headers: { "Content-Type": "application/octet-stream" },
  });

  if (!uploadResp.ok) {
    const err = await uploadResp.json();
    console.error(`  ✕ Upload failed: ${(err as any).message}`);
    process.exit(1);
  }

  // 5. Start deploy
  console.log("  Building...");
  const deployResp = await api(creds, "/api/deploy/start", {
    method: "POST",
    body: JSON.stringify({ projectName: config.name, config }),
  });

  if (!deployResp.ok) {
    const err = await deployResp.json();
    console.error(`  ✕ Deploy failed: ${(err as any).message}`);
    process.exit(1);
  }

  const { data: deploy } = await deployResp.json() as any;

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
            console.log(`    ${msg.data}`);
          } else if (msg.type === "status") {
            if (msg.status === "live") {
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              resolve();
            } else if (msg.status === "failed") {
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

    console.log(`  ✓ https://${config.name}.${process.env.VOSS_DOMAIN ?? "yourdomain.com"}`);
  } catch (err) {
    const msg = (err as Error).message;

    if (msg === "failed") {
      console.error("  ✕ Deploy failed");
      console.error(`    Full log: voss logs --deploy ${deploy.deploymentId}`);
      process.exit(1);
    }

    // WebSocket failed, fall back to polling
    if (msg === "ws_error" || msg === "ws_closed") {
      console.log("    (streaming unavailable, polling...)");
    }

    let lastStatus = "";
    while (true) {
      const statusResp = await api(creds, `/api/deployments/${deploy.deploymentId}`);
      const { data: d } = await statusResp.json() as any;

      if (d.status !== lastStatus) {
        lastStatus = d.status;
        if (d.status === "live") {
          console.log(`  Health check: ● passed`);
          console.log(`  ✓ https://${config.name}.${process.env.VOSS_DOMAIN ?? "yourdomain.com"}`);
          return;
        }
        if (d.status === "failed") {
          console.error("  ✕ Deploy failed");
          console.error(`    Full log: voss logs --deploy ${deploy.deploymentId}`);
          process.exit(1);
        }
      }
      await Bun.sleep(2000);
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
    "dist",
    ".next",
    ".nuxt",
    ".output",
    ".env",
    ".env.local",
  ];

  // Load .vossignore if exists
  const vossignorePath = join(dir, ".vossignore");
  if (existsSync(vossignorePath)) {
    const content = await Bun.file(vossignorePath).text();
    ignorePatterns.push(...content.split("\n").filter(Boolean));
  }

  const files: string[] = [];

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      if (ignorePatterns.some((p) => name === p || name.startsWith(p + "/"))) continue;

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
