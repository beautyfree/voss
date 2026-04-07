import { $ } from "bun";

export interface CreateContainerOpts {
  name: string;
  image: string;
  network: string;
  envVars?: Record<string, string>;
  volumes?: string[]; // "host:container" or named "vol:/path"
  labels?: Record<string, string>;
  memory?: string;
  cpu?: number;
  restart?: string;
  cmd?: string[];
}

/**
 * Create and start a Docker container. Returns container ID.
 */
export async function createContainer(opts: CreateContainerOpts): Promise<string> {
  const args: string[] = [
    "docker", "run", "-d",
    "--name", opts.name,
    "--network", opts.network,
    "--restart", opts.restart ?? "unless-stopped",
  ];

  if (opts.memory) {
    args.push("--memory", opts.memory);
  }
  if (opts.cpu) {
    args.push("--cpus", String(opts.cpu));
  }
  if (opts.volumes) {
    for (const v of opts.volumes) {
      args.push("-v", v);
    }
  }
  if (opts.envVars) {
    for (const [k, v] of Object.entries(opts.envVars)) {
      args.push("-e", `${k}=${v}`);
    }
  }
  if (opts.labels) {
    for (const [k, v] of Object.entries(opts.labels)) {
      args.push("--label", `${k}=${v}`);
    }
  }

  args.push(opts.image);

  if (opts.cmd) {
    args.push(...opts.cmd);
  }

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to create container ${opts.name}: ${stderr.trim()}`);
  }

  const stdout = await new Response(proc.stdout).text();
  return stdout.trim();
}

/**
 * Connect a container to an additional Docker network.
 */
export async function connectNetwork(containerName: string, network: string): Promise<void> {
  try {
    await $`docker network connect ${network} ${containerName}`.quiet();
  } catch (e) {
    const msg = (e as Error).message;
    // Already connected is not an error
    if (!msg.includes("already exists")) throw e;
  }
}

/**
 * Check if a container exists and get its status.
 */
export async function inspectContainer(name: string): Promise<{ exists: boolean; running: boolean }> {
  try {
    const result = await $`docker inspect -f ${"{{.State.Running}}"} ${name}`.text();
    return { exists: true, running: result.trim() === "true" };
  } catch {
    return { exists: false, running: false };
  }
}

/**
 * Start an existing stopped container.
 */
export async function startContainer(name: string): Promise<void> {
  await $`docker start ${name}`.quiet();
}

/**
 * Stop and remove a container.
 */
export async function removeContainer(name: string): Promise<void> {
  try {
    await $`docker stop -t 10 ${name}`.quiet();
  } catch {
    // May already be stopped
  }
  try {
    await $`docker rm ${name}`.quiet();
  } catch {
    // May already be removed
  }
}

/**
 * Remove a Docker volume.
 */
export async function removeVolume(volumeName: string): Promise<void> {
  try {
    await $`docker volume rm ${volumeName}`.quiet();
  } catch (e) {
    console.error(`[docker] Failed to remove volume ${volumeName}:`, (e as Error).message);
  }
}

/**
 * Execute a command inside a running container. Returns stdout.
 */
export async function dockerExec(containerName: string, cmd: string[]): Promise<string> {
  const args = ["docker", "exec", containerName, ...cmd];
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`docker exec in ${containerName} failed: ${stderr.trim()}`);
  }

  return await new Response(proc.stdout).text();
}

/**
 * Pull a Docker image if not cached locally.
 */
export async function ensureImage(image: string): Promise<void> {
  try {
    await $`docker image inspect ${image}`.quiet();
  } catch {
    await $`docker pull ${image}`;
  }
}

/**
 * List Docker volumes matching a prefix.
 */
export async function listVolumes(prefix: string): Promise<string[]> {
  try {
    const result = await $`docker volume ls --format ${"{{.Name}}"} -f name=${prefix}`.text();
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
