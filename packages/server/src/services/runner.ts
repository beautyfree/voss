import { $ } from "bun";
import {
  RUNNERS,
  DOCKER_NETWORK_RUNNER,
  VOSS_UPLOADS_DIR,
  VOSS_LOG_DIR,
  type FrameworkId,
  type VossConfig,
} from "@voss/shared";

interface RunContainerOpts {
  projectName: string;
  deploymentId: string;
  framework: FrameworkId;
  config: VossConfig;
  envVars: Record<string, string>;
  uploadDir: string;
}

interface RunResult {
  containerId: string;
  containerName: string;
}

/**
 * Create and start a runner container for a deployment.
 * 1. Pull runner image if needed
 * 2. Create container with code volume + build/start commands
 * 3. Connect to voss_runner network with Traefik labels
 * 4. Start and return container info
 */
export async function runContainer(opts: RunContainerOpts): Promise<RunResult> {
  const runner = RUNNERS[opts.framework];
  const containerName = `voss-${opts.projectName}-${opts.deploymentId.slice(0, 8)}`;
  const logPath = `${VOSS_LOG_DIR}/${opts.projectName}/${opts.deploymentId}.log`;

  // Ensure log directory exists
  await $`mkdir -p ${VOSS_LOG_DIR}/${opts.projectName}`;

  // Pull image if not cached
  try {
    await $`docker image inspect ${runner.image}`.quiet();
  } catch {
    await $`docker pull ${runner.image}`;
  }

  // Detect package manager from lock files
  const { prefix: pmPrefix, pm } = await detectPackageManager(opts.uploadDir);

  // Use rootDirectory from config, or auto-detect monorepo app directory
  const appDir = opts.config.rootDirectory ?? await detectAppDir(opts.uploadDir, opts.framework);

  // Build the command chain: install pkg manager, install deps, build, start
  // Replace npm with detected package manager in default commands
  let buildCmd = opts.config.buildCommand ?? runner.buildCommand;
  let startCmd = opts.config.startCommand ?? runner.startCommand;
  if (pm !== "npm" && !opts.config.buildCommand) {
    buildCmd = buildCmd.replace(/\bnpm\b/g, pm);
  }
  if (pm !== "npm" && !opts.config.startCommand) {
    startCmd = startCmd.replace(/\bnpm\b/g, pm);
  }
  const port = runner.port;

  // Env vars as -e flags + NODE_OPTIONS for heap size
  const allEnv: Record<string, string> = {
    NODE_OPTIONS: "--max-old-space-size=1024",
    ...opts.envVars,
  };
  const envFlags = Object.entries(allEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

  // Resource limits — default 1.5GB for build (Next.js needs ~1GB heap)
  const memoryLimit = opts.config.resources?.memory ?? "1536m";
  const cpuLimit = opts.config.resources?.cpu ?? 1;

  // Labels for identification only — routing is via Traefik file provider
  const labels = [
    `--label=voss.project=${opts.projectName}`,
    `--label=voss.deployment=${opts.deploymentId}`,
  ];

  // Create and start container
  // For monorepos: install from root, then start from app dir
  const startDir = appDir ? `/app/${appDir}` : "/app";
  // In monorepo, use npx/pnpx to run framework start directly from app dir
  const finalStartCmd = appDir ? `npx next start -p ${port}` : startCmd;
  const entrypoint = `cd /app && ${pmPrefix}${buildCmd} && cd ${startDir} && ${finalStartCmd}`;

  const result = await $`docker run -d \
    --name ${containerName} \
    --network ${DOCKER_NETWORK_RUNNER} \
    --restart unless-stopped \
    --memory ${memoryLimit} \
    --cpus ${String(cpuLimit)} \
    --stop-timeout 30 \
    -v ${opts.uploadDir}:/app \
    -w /app \
    ${envFlags} \
    ${labels} \
    ${runner.image} \
    sh -c ${entrypoint}`.text();

  const containerId = result.trim();

  return { containerId, containerName };
}

/**
 * Detect the app directory in a monorepo.
 * Searches apps/ and packages/ for framework config files.
 * Returns relative path from root, or null if not a monorepo.
 */
async function detectAppDir(uploadDir: string, framework: FrameworkId): Promise<string | null> {
  const { existsSync, readdirSync, statSync } = await import("fs");
  const { join } = await import("path");

  // If framework config is in root, not a monorepo
  const runner = RUNNERS[framework];
  if (runner.detectFiles.some(f => existsSync(join(uploadDir, f)))) {
    // Check if there's also a turbo.json or workspaces — might be monorepo root
    const hasTurbo = existsSync(join(uploadDir, "turbo.json"));
    if (!hasTurbo) return null;
  }

  // Search common monorepo dirs for the framework config
  const searchDirs = ["apps", "packages"];
  for (const dir of searchDirs) {
    const dirPath = join(uploadDir, dir);
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue;

    for (const sub of readdirSync(dirPath)) {
      const subPath = join(dirPath, sub);
      if (!statSync(subPath).isDirectory()) continue;

      // Check for framework config files in subdirectory
      for (const detectFile of runner.detectFiles) {
        if (existsSync(join(subPath, detectFile))) {
          return `${dir}/${sub}`;
        }
      }
    }
  }

  return null;
}

/**
 * Detect package manager from lock files and return install command prefix.
 */
async function detectPackageManager(uploadDir: string): Promise<{ prefix: string; pm: string }> {
  const { existsSync } = await import("fs");
  const { join } = await import("path");

  if (existsSync(join(uploadDir, "pnpm-lock.yaml"))) {
    return { prefix: "corepack enable && corepack prepare pnpm@latest --activate && ", pm: "pnpm" };
  }
  if (existsSync(join(uploadDir, "yarn.lock"))) {
    return { prefix: "corepack enable && ", pm: "yarn" };
  }
  if (existsSync(join(uploadDir, "bun.lock")) || existsSync(join(uploadDir, "bun.lockb"))) {
    return { prefix: "npm install -g bun && ", pm: "bun" };
  }
  return { prefix: "", pm: "npm" };
}

/**
 * Stop and remove a container.
 */
export async function stopContainer(containerName: string): Promise<void> {
  try {
    await $`docker stop -t 30 ${containerName}`.quiet();
    await $`docker rm ${containerName}`.quiet();
  } catch {
    // Container may already be stopped/removed
  }
}

/**
 * Check if a container is healthy by HTTP probing.
 */
export async function healthCheck(
  containerName: string,
  path: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  const interval = 2000; // check every 2s

  while (Date.now() - start < timeoutMs) {
    try {
      // Get container IP on the runner network
      const ip = await $`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${containerName}`.text();
      const containerIp = ip.trim();

      if (containerIp) {
        const resp = await fetch(`http://${containerIp}:3000${path}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) return true;
      }
    } catch {
      // Not ready yet
    }
    await Bun.sleep(interval);
  }

  return false;
}

/**
 * Stream container logs to a file and return the path.
 */
export async function streamLogs(
  containerName: string,
  logPath: string,
): Promise<void> {
  const proc = Bun.spawn(["docker", "logs", "-f", containerName], {
    stdout: Bun.file(logPath),
    stderr: Bun.file(logPath),
  });
  // Don't await — this runs in background
}
