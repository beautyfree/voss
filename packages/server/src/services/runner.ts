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

  // Build the command chain: copy code, install deps, build, start
  const buildCmd = opts.config.buildCommand ?? runner.buildCommand;
  const startCmd = opts.config.startCommand ?? runner.startCommand;
  const port = runner.port;

  // Env vars as -e flags
  const envFlags = Object.entries(opts.envVars).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

  // Resource limits
  const memoryLimit = opts.config.resources?.memory ?? "512m";
  const cpuLimit = opts.config.resources?.cpu ?? 0.5;

  // Traefik labels for routing
  const routerName = `voss-${opts.projectName}`;
  const labels = [
    `--label=traefik.enable=true`,
    `--label=traefik.http.routers.${routerName}.rule=Host(\`${opts.projectName}.{{DOMAIN}}\`)`,
    `--label=traefik.http.routers.${routerName}.entrypoints=websecure`,
    `--label=traefik.http.routers.${routerName}.tls=true`,
    `--label=traefik.http.routers.${routerName}.tls.certresolver=letsencrypt`,
    `--label=traefik.http.services.${routerName}.loadbalancer.server.port=${port}`,
    `--label=voss.project=${opts.projectName}`,
    `--label=voss.deployment=${opts.deploymentId}`,
  ];

  // Create and start container
  // The entrypoint: cd into code dir, run build, then start
  const entrypoint = `cd /app && ${buildCmd} && ${startCmd}`;

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
