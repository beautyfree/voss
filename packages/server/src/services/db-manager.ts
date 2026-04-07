import { $ } from "bun";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
  DB_IMAGES,
  DB_DEFAULT_VERSIONS,
  DB_DEFAULT_PORTS,
  DB_ENV_KEYS,
  SHARED_CONTAINERS,
  VOSS_VOLUMES_DIR,
  VOSS_DB_BACKUP_DIR,
  DOCKER_NETWORK_INTERNAL,
  DOCKER_NETWORK_RUNNER,
  type ServiceType,
  type ServiceTier,
  type ServiceConfig,
  type ServiceProvider,
  type VossConfig,
} from "@voss/shared";
import {
  createContainer,
  connectNetwork,
  inspectContainer,
  startContainer,
  removeContainer,
  removeVolume,
  dockerExec,
  ensureImage,
} from "./docker-utils";
import { logEvent } from "./events";

// Separate lock for DB provisioning (not the build queue)
let provisioning = false;
const provisionQueue: (() => void)[] = [];

async function acquireProvisionLock(): Promise<void> {
  if (!provisioning) {
    provisioning = true;
    return;
  }
  return new Promise((resolve) => provisionQueue.push(resolve));
}

function releaseProvisionLock() {
  provisioning = false;
  const next = provisionQueue.shift();
  if (next) {
    provisioning = true;
    next();
  }
}

// ── Shared Tier (Tier 2) ──

/**
 * Initialize the shared Postgres container. Idempotent.
 */
export async function initSharedPostgres(): Promise<void> {
  const name = SHARED_CONTAINERS.postgres;
  const { exists, running } = await inspectContainer(name);

  if (exists && running) return;
  if (exists && !running) {
    await startContainer(name);
    await connectNetwork(name, DOCKER_NETWORK_RUNNER);
    return;
  }

  const version = DB_DEFAULT_VERSIONS.postgres;
  const image = DB_IMAGES.postgres[version];
  const volumeName = "voss-vol-shared-postgres";
  const password = generatePassword();

  await ensureImage(image);
  await $`mkdir -p ${VOSS_VOLUMES_DIR}`;

  const hostPort = allocateHostPort();

  await createContainer({
    name,
    image,
    network: DOCKER_NETWORK_INTERNAL,
    envVars: {
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: "voss_admin",
    },
    volumes: [`${volumeName}:/var/lib/postgresql/data`],
    portMappings: [`${hostPort}:5432`],
    labels: { "voss.service": "shared-postgres" },
    memory: "512m",
    cpu: 0.5,
  });

  // Connect to runner network so app containers can reach it
  await connectNetwork(name, DOCKER_NETWORK_RUNNER);

  // Wait for Postgres to be ready
  await waitForPostgres(name, "voss_admin", password);

  // Store the admin password in a well-known location
  // This is used internally for CREATE DATABASE/USER operations
  await $`mkdir -p ${VOSS_VOLUMES_DIR}/.secrets`;
  await Bun.write(`${VOSS_VOLUMES_DIR}/.secrets/shared-postgres-password`, password);

  console.log("[db-manager] Shared Postgres initialized");
}

/**
 * Initialize the shared Redis container. Idempotent.
 */
export async function initSharedRedis(): Promise<void> {
  const name = SHARED_CONTAINERS.redis;
  const { exists, running } = await inspectContainer(name);

  if (exists && running) return;
  if (exists && !running) {
    await startContainer(name);
    await connectNetwork(name, DOCKER_NETWORK_RUNNER);
    return;
  }

  const version = DB_DEFAULT_VERSIONS.redis;
  const image = DB_IMAGES.redis[version];
  const volumeName = "voss-vol-shared-redis";
  const hostPort = allocateHostPort();

  await ensureImage(image);

  await createContainer({
    name,
    image,
    network: DOCKER_NETWORK_INTERNAL,
    volumes: [`${volumeName}:/data`],
    portMappings: [`${hostPort}:6379`],
    labels: { "voss.service": "shared-redis" },
    memory: "256m",
    cpu: 0.25,
  });

  await connectNetwork(name, DOCKER_NETWORK_RUNNER);

  // Wait for Redis to be ready
  await waitForRedis(name);

  console.log("[db-manager] Shared Redis initialized");
}

/**
 * Create a project database in the shared Postgres instance.
 * Returns the env vars to inject.
 */
export async function createSharedPostgresDb(
  projectName: string,
  projectId: string,
): Promise<Record<string, string>> {
  await initSharedPostgres();

  const dbName = `voss_${projectName.replace(/-/g, "_")}`;
  const userName = dbName;
  const password = generatePassword();
  const containerName = SHARED_CONTAINERS.postgres;
  const port = DB_DEFAULT_PORTS.postgres;
  const envKey = DB_ENV_KEYS.postgres;

  // Create database and user (idempotent)
  const adminPassword = await getSharedPostgresPassword();
  try {
    await dockerExec(containerName, [
      "psql", "-U", "voss_admin", "-c",
      `CREATE USER ${userName} WITH PASSWORD '${password}' CONNECTION LIMIT 10;`,
    ]);
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes("already exists")) throw e;
  }

  try {
    await dockerExec(containerName, [
      "psql", "-U", "voss_admin", "-c",
      `CREATE DATABASE ${dbName} OWNER ${userName};`,
    ]);
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes("already exists")) throw e;
  }

  const connectionUrl = `postgresql://${userName}:${password}@${containerName}:${port}/${dbName}`;

  // Store service record
  const db = getDb();
  const now = new Date().toISOString();
  const serviceId = crypto.randomUUID();

  db.insert(schema.services)
    .values({
      id: serviceId,
      projectId,
      type: "postgres",
      tier: "shared",
      version: DB_DEFAULT_VERSIONS.postgres,
      containerName,
      containerStatus: "running",
      dbName,
      envKey,
      port,
      config: "{}",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Store connection URL as env var
  upsertEnvVar(projectId, envKey, connectionUrl);

  logEvent(projectId, "service_created", `Created shared Postgres database: ${dbName}`, {
    serviceId,
    type: "postgres",
    tier: "shared",
  });

  return { [envKey]: connectionUrl };
}

/**
 * Create a project Redis connection in the shared Redis instance.
 */
export async function createSharedRedis(
  projectName: string,
  projectId: string,
): Promise<Record<string, string>> {
  await initSharedRedis();

  const containerName = SHARED_CONTAINERS.redis;
  const port = DB_DEFAULT_PORTS.redis;
  const envKey = DB_ENV_KEYS.redis;
  // Redis has no per-database isolation in a meaningful way,
  // but we can use database numbers (0-15)
  const dbNum = await getNextRedisDbNum(projectId);
  const connectionUrl = `redis://${containerName}:${port}/${dbNum}`;

  const db = getDb();
  const now = new Date().toISOString();
  const serviceId = crypto.randomUUID();

  db.insert(schema.services)
    .values({
      id: serviceId,
      projectId,
      type: "redis",
      tier: "shared",
      version: DB_DEFAULT_VERSIONS.redis,
      containerName,
      containerStatus: "running",
      dbName: `db${dbNum}`,
      envKey,
      port,
      config: "{}",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  upsertEnvVar(projectId, envKey, connectionUrl);

  logEvent(projectId, "service_created", `Created shared Redis (db${dbNum})`, {
    serviceId,
    type: "redis",
    tier: "shared",
  });

  return { [envKey]: connectionUrl };
}

// ── Isolated Tier (Tier 3) ──

/**
 * Create an isolated database container for a project.
 */
export async function createIsolatedService(
  projectName: string,
  projectId: string,
  type: ServiceType,
  config: ServiceConfig = {},
): Promise<Record<string, string>> {
  const version = config.version ?? DB_DEFAULT_VERSIONS[type];
  const image = DB_IMAGES[type]?.[version];
  if (!image) throw new Error(`No image for ${type}:${version}`);

  const containerName = `voss-db-${projectName}-${type}`;
  const volumeName = `voss-vol-${projectName}-${type}`;
  const port = DB_DEFAULT_PORTS[type];
  const envKey = DB_ENV_KEYS[type];
  const memory = config.memory ?? (type === "postgres" ? "512m" : "256m");

  // Check if already exists
  const { exists, running } = await inspectContainer(containerName);
  if (exists && running) {
    // Already running, just return the env var
    const db = getDb();
    const existing = db.select().from(schema.envVars)
      .where(and(eq(schema.envVars.projectId, projectId), eq(schema.envVars.key, envKey)))
      .get();
    return existing ? { [envKey]: existing.value } : {};
  }
  if (exists && !running) {
    await startContainer(containerName);
    await connectNetwork(containerName, DOCKER_NETWORK_RUNNER);
    const db = getDb();
    db.update(schema.services)
      .set({ containerStatus: "running", updatedAt: new Date().toISOString() })
      .where(eq(schema.services.containerName, containerName))
      .run();
    const existing = db.select().from(schema.envVars)
      .where(and(eq(schema.envVars.projectId, projectId), eq(schema.envVars.key, envKey)))
      .get();
    return existing ? { [envKey]: existing.value } : {};
  }

  await ensureImage(image);

  const hostPort = allocateHostPort();
  let connectionUrl: string;
  const containerEnv: Record<string, string> = {};

  if (type === "postgres") {
    const password = generatePassword();
    containerEnv.POSTGRES_PASSWORD = password;
    containerEnv.POSTGRES_USER = "app";
    containerEnv.POSTGRES_DB = "app";
    connectionUrl = `postgresql://app:${password}@${containerName}:${port}/app`;
  } else {
    // Redis
    connectionUrl = `redis://${containerName}:${port}/0`;
  }

  await createContainer({
    name: containerName,
    image,
    network: DOCKER_NETWORK_INTERNAL,
    envVars: containerEnv,
    volumes: [`${volumeName}:/var/lib/${type === "postgres" ? "postgresql/data" : "redis"}`],
    portMappings: [`${hostPort}:${port}`],
    labels: {
      "voss.service": type,
      "voss.project": projectName,
    },
    memory,
    cpu: config.memory ? 1 : 0.5,
  });

  await connectNetwork(containerName, DOCKER_NETWORK_RUNNER);

  // Wait for readiness
  if (type === "postgres") {
    await waitForPostgres(containerName, "app", containerEnv.POSTGRES_PASSWORD);
  } else {
    await waitForRedis(containerName);
  }

  // Store service record
  const db = getDb();
  const now = new Date().toISOString();
  const serviceId = crypto.randomUUID();

  db.insert(schema.services)
    .values({
      id: serviceId,
      projectId,
      type,
      tier: "isolated",
      version,
      containerName,
      containerStatus: "running",
      envKey,
      volumePath: volumeName,
      port: hostPort,
      config: JSON.stringify(config),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  upsertEnvVar(projectId, envKey, connectionUrl);

  logEvent(projectId, "service_created", `Created isolated ${type} container: ${containerName}`, {
    serviceId,
    type,
    tier: "isolated",
  });

  return { [envKey]: connectionUrl };
}

// ── External Tier (Tier 4) ──

/**
 * Connect an external database provider. Validates URL and stores as env var.
 */
export async function connectExternalService(
  projectId: string,
  type: ServiceType,
  provider: ServiceProvider,
  connectionUrl: string,
): Promise<void> {
  const envKey = DB_ENV_KEYS[type] ?? "DATABASE_URL";

  const db = getDb();
  const now = new Date().toISOString();
  const serviceId = crypto.randomUUID();

  db.insert(schema.services)
    .values({
      id: serviceId,
      projectId,
      type,
      tier: "external",
      provider,
      envKey,
      config: "{}",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  upsertEnvVar(projectId, envKey, connectionUrl);

  logEvent(projectId, "service_connected", `Connected external ${provider} (${type})`, {
    serviceId,
    provider,
  });
}

// ── Deploy Integration ──

/**
 * Ensure all services declared in voss.json exist and are running.
 * Called BEFORE acquireBuildSlot() in the deploy pipeline.
 * Returns env vars to merge into the deploy.
 */
export async function ensureServicesForProject(
  projectName: string,
  projectId: string,
  config: VossConfig,
): Promise<Record<string, string>> {
  if (!config.services) return {};

  await acquireProvisionLock();
  try {
    const envVars: Record<string, string> = {};
    const db = getDb();

    for (const [typeStr, svcConfig] of Object.entries(config.services)) {
      const type = typeStr as ServiceType;
      if (!svcConfig) continue;

      const cfg: ServiceConfig = svcConfig === true ? {} : svcConfig;
      const tier = cfg.tier ?? "shared";
      const envKey = DB_ENV_KEYS[type];

      // Check if service already exists for this project
      const existing = db.select().from(schema.services)
        .where(and(
          eq(schema.services.projectId, projectId),
          eq(schema.services.type, type),
        ))
        .get();

      if (existing) {
        // Service exists — make sure container is running
        if (existing.containerName) {
          const { running } = await inspectContainer(existing.containerName);
          if (!running) {
            try {
              await startContainer(existing.containerName);
              await connectNetwork(existing.containerName, DOCKER_NETWORK_RUNNER);
              db.update(schema.services)
                .set({ containerStatus: "running", updatedAt: new Date().toISOString() })
                .where(eq(schema.services.id, existing.id))
                .run();
            } catch (e) {
              console.error(`[db-manager] Failed to restart ${existing.containerName}:`, (e as Error).message);
            }
          }
        }
        // Read existing env var
        const envVar = db.select().from(schema.envVars)
          .where(and(eq(schema.envVars.projectId, projectId), eq(schema.envVars.key, envKey)))
          .get();
        if (envVar) envVars[envKey] = envVar.value;
        continue;
      }

      // Service doesn't exist — create it
      let result: Record<string, string>;
      if (tier === "shared") {
        if (type === "postgres") {
          result = await createSharedPostgresDb(projectName, projectId);
        } else {
          result = await createSharedRedis(projectName, projectId);
        }
      } else {
        result = await createIsolatedService(projectName, projectId, type, cfg);
      }
      Object.assign(envVars, result);
    }

    return envVars;
  } finally {
    releaseProvisionLock();
  }
}

// ── Backup & Restore ──

/**
 * Create a backup of a service. Returns backup record ID.
 */
export async function backupService(
  serviceId: string,
  type: "manual" | "scheduled" | "pre-delete" = "manual",
): Promise<string> {
  const db = getDb();
  const service = db.select().from(schema.services)
    .where(eq(schema.services.id, serviceId))
    .get();

  if (!service) throw new Error(`Service ${serviceId} not found`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${VOSS_DB_BACKUP_DIR}/${serviceId}`;
  await $`mkdir -p ${backupDir}`;

  let filePath: string;
  let sizeBytes = 0;

  if (service.type === "postgres") {
    filePath = `${backupDir}/${timestamp}.sql.gz`;
    const containerName = service.containerName ?? SHARED_CONTAINERS.postgres;

    // Ensure container is running
    const { running } = await inspectContainer(containerName);
    if (!running) {
      try {
        await startContainer(containerName);
      } catch (e) {
        throw new Error(`Cannot backup: container ${containerName} is not running and couldn't be started`);
      }
    }

    const dbName = service.dbName ?? "app";
    const user = service.tier === "shared" ? "voss_admin" : "app";

    // pg_dump piped through gzip
    const proc = Bun.spawn(
      ["sh", "-c", `docker exec ${containerName} pg_dump -U ${user} ${dbName} | gzip > ${filePath}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      // Clean up partial file
      try { await $`rm -f ${filePath}`.quiet(); } catch {}
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`pg_dump failed: ${stderr.trim()}`);
    }

    try {
      const stat = await Bun.file(filePath).stat();
      sizeBytes = stat?.size ?? 0;
    } catch {}
  } else if (service.type === "redis") {
    filePath = `${backupDir}/${timestamp}.rdb`;
    const containerName = service.containerName ?? SHARED_CONTAINERS.redis;

    const { running } = await inspectContainer(containerName);
    if (!running) {
      try { await startContainer(containerName); } catch (e) {
        throw new Error(`Cannot backup: container ${containerName} is not running`);
      }
    }

    await dockerExec(containerName, ["redis-cli", "BGSAVE"]);
    // Wait briefly for save to complete
    await Bun.sleep(2000);
    // Copy RDB file out
    await $`docker cp ${containerName}:/data/dump.rdb ${filePath}`.quiet();

    try {
      const stat = await Bun.file(filePath).stat();
      sizeBytes = stat?.size ?? 0;
    } catch {}
  } else {
    throw new Error(`Backup not supported for type: ${service.type}`);
  }

  const backupId = crypto.randomUUID();
  db.insert(schema.serviceBackups)
    .values({
      id: backupId,
      serviceId,
      filePath,
      sizeBytes,
      type,
      createdAt: new Date().toISOString(),
    })
    .run();

  return backupId;
}

/**
 * Restore a service from a backup.
 */
export async function restoreService(serviceId: string, backupId: string): Promise<void> {
  const db = getDb();
  const service = db.select().from(schema.services)
    .where(eq(schema.services.id, serviceId)).get();
  const backup = db.select().from(schema.serviceBackups)
    .where(eq(schema.serviceBackups.id, backupId)).get();

  if (!service) throw new Error("Service not found");
  if (!backup) throw new Error("Backup not found");

  const containerName = service.containerName ??
    (service.tier === "shared" ? SHARED_CONTAINERS[service.type as keyof typeof SHARED_CONTAINERS] : null);
  if (!containerName) throw new Error("No container to restore to");

  if (service.type === "postgres") {
    const dbName = service.dbName ?? "app";
    const user = service.tier === "shared" ? "voss_admin" : "app";
    // Decompress and restore
    await Bun.spawn(
      ["sh", "-c", `gunzip -c ${backup.filePath} | docker exec -i ${containerName} psql -U ${user} ${dbName}`],
      { stdout: "inherit", stderr: "inherit" },
    ).exited;
  } else if (service.type === "redis") {
    // Stop Redis, copy RDB, restart
    await $`docker exec ${containerName} redis-cli SHUTDOWN NOSAVE`.quiet().catch(() => {});
    await $`docker cp ${backup.filePath} ${containerName}:/data/dump.rdb`.quiet();
    await startContainer(containerName);
  }
}

// ── Cleanup ──

/**
 * Delete a service and its resources. Auto-backups before delete.
 */
export async function deleteService(serviceId: string): Promise<void> {
  const db = getDb();
  const service = db.select().from(schema.services)
    .where(eq(schema.services.id, serviceId)).get();

  if (!service) return;

  // Auto-backup before delete (best effort)
  try {
    await backupService(serviceId, "pre-delete");
  } catch (e) {
    console.error(`[db-manager] Pre-delete backup failed for ${serviceId}:`, (e as Error).message);
  }

  if (service.tier === "shared" && service.type === "postgres" && service.dbName) {
    // Drop database and user in shared instance
    const containerName = SHARED_CONTAINERS.postgres;
    try {
      await dockerExec(containerName, [
        "psql", "-U", "voss_admin", "-c",
        `DROP DATABASE IF EXISTS ${service.dbName};`,
      ]);
      await dockerExec(containerName, [
        "psql", "-U", "voss_admin", "-c",
        `DROP USER IF EXISTS ${service.dbName};`,
      ]);
    } catch (e) {
      console.error(`[db-manager] Failed to drop shared DB ${service.dbName}:`, (e as Error).message);
    }
  } else if (service.tier === "isolated" && service.containerName) {
    // Stop and remove container + volume
    await removeContainer(service.containerName);
    if (service.volumePath) {
      await removeVolume(service.volumePath);
    }
  }
  // External tier: nothing to clean up (just metadata)

  // Remove env var
  if (service.envKey && service.projectId) {
    db.delete(schema.envVars)
      .where(and(
        eq(schema.envVars.projectId, service.projectId),
        eq(schema.envVars.key, service.envKey),
      ))
      .run();
  }

  // Delete backup records and files
  const backups = db.select().from(schema.serviceBackups)
    .where(eq(schema.serviceBackups.serviceId, serviceId)).all();
  for (const b of backups) {
    try { await $`rm -f ${b.filePath}`.quiet(); } catch {}
  }
  db.delete(schema.serviceBackups)
    .where(eq(schema.serviceBackups.serviceId, serviceId)).run();

  // Delete service record
  db.delete(schema.services)
    .where(eq(schema.services.id, serviceId)).run();

  if (service.projectId) {
    logEvent(service.projectId, "service_deleted", `Deleted ${service.tier} ${service.type} service`, {
      serviceId,
    });
  }
}

/**
 * Delete all services for a project (called from project delete).
 */
export async function deleteProjectServices(projectId: string): Promise<void> {
  const db = getDb();
  const services = db.select().from(schema.services)
    .where(eq(schema.services.projectId, projectId)).all();

  for (const svc of services) {
    await deleteService(svc.id);
  }
}

// ── Startup Reconciliation ──

/**
 * Reconcile DB container status with Docker reality.
 * Called from startup.ts.
 */
export async function reconcileServiceStatus(): Promise<void> {
  const db = getDb();
  const allServices = db.select().from(schema.services).all();

  for (const svc of allServices) {
    if (!svc.containerName) continue;

    const { exists, running } = await inspectContainer(svc.containerName);
    const newStatus = !exists ? "stopped" : running ? "running" : "stopped";

    if (newStatus !== svc.containerStatus) {
      db.update(schema.services)
        .set({ containerStatus: newStatus, updatedAt: new Date().toISOString() })
        .where(eq(schema.services.id, svc.id))
        .run();

      // Auto-restart DB containers that should be running
      if (exists && !running && (svc.tier === "shared" || svc.tier === "isolated")) {
        try {
          await startContainer(svc.containerName);
          await connectNetwork(svc.containerName, DOCKER_NETWORK_RUNNER);
          db.update(schema.services)
            .set({ containerStatus: "running", updatedAt: new Date().toISOString() })
            .where(eq(schema.services.id, svc.id))
            .run();
          console.log(`[db-manager] Restarted ${svc.containerName}`);
        } catch (e) {
          console.error(`[db-manager] Failed to restart ${svc.containerName}:`, (e as Error).message);
        }
      }
    }
  }
}

/**
 * Get status of shared infrastructure.
 */
export async function getSharedStatus(): Promise<{
  postgres: { running: boolean; exists: boolean };
  redis: { running: boolean; exists: boolean };
}> {
  const [pg, rd] = await Promise.all([
    inspectContainer(SHARED_CONTAINERS.postgres),
    inspectContainer(SHARED_CONTAINERS.redis),
  ]);
  return { postgres: pg, redis: rd };
}

// ── Helpers ──

const HOST_PORT_MIN = 10000;
const HOST_PORT_MAX = 10999;

/**
 * Allocate an available host port for external DB access.
 */
function allocateHostPort(): number {
  const db = getDb();
  const usedPorts = new Set(
    db.select().from(schema.services).all()
      .map(s => s.port)
      .filter((p): p is number => p !== null && p >= HOST_PORT_MIN && p <= HOST_PORT_MAX)
  );
  for (let port = HOST_PORT_MIN; port <= HOST_PORT_MAX; port++) {
    if (!usedPorts.has(port)) return port;
  }
  throw new Error("No available host ports for database proxy (10000-10999 exhausted)");
}

/**
 * Get external connection info for a service.
 */
export function getExternalConnectionInfo(service: any): {
  host: string;
  port: number;
  connectionUrl: string;
} | null {
  if (!service.port || service.port < HOST_PORT_MIN) return null;
  const domain = process.env.VOSS_DOMAIN ?? "localhost";
  const host = /^\d+\.\d+\.\d+\.\d+$/.test(domain) ? domain : domain;

  if (service.type === "postgres") {
    return {
      host,
      port: service.port,
      connectionUrl: `postgresql://app:***@${host}:${service.port}/app`,
    };
  } else if (service.type === "redis") {
    return {
      host,
      port: service.port,
      connectionUrl: `redis://${host}:${service.port}/0`,
    };
  }
  return null;
}

function generatePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

async function getSharedPostgresPassword(): Promise<string> {
  const path = `${VOSS_VOLUMES_DIR}/.secrets/shared-postgres-password`;
  try {
    return await Bun.file(path).text();
  } catch {
    throw new Error("Shared Postgres password not found. Run 'voss db init' first.");
  }
}

async function waitForPostgres(containerName: string, user: string, password: string): Promise<void> {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await dockerExec(containerName, ["pg_isready", "-U", user]);
      return;
    } catch {
      await Bun.sleep(1000);
    }
  }
  throw new Error(`Postgres container ${containerName} did not become ready in ${maxAttempts}s`);
}

async function waitForRedis(containerName: string): Promise<void> {
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await dockerExec(containerName, ["redis-cli", "ping"]);
      if (result.trim() === "PONG") return;
    } catch {
      await Bun.sleep(1000);
    }
  }
  throw new Error(`Redis container ${containerName} did not become ready in ${maxAttempts}s`);
}

async function getNextRedisDbNum(projectId: string): Promise<number> {
  const db = getDb();
  const existing = db.select().from(schema.services)
    .where(and(
      eq(schema.services.type, "redis"),
      eq(schema.services.tier, "shared"),
    ))
    .all();
  // Use database numbers 1-15 (0 is default)
  const usedNums = new Set(existing.map(s => {
    const match = s.dbName?.match(/^db(\d+)$/);
    return match ? parseInt(match[1]) : 0;
  }));
  for (let i = 1; i <= 15; i++) {
    if (!usedNums.has(i)) return i;
  }
  return 0; // Fallback to db0
}

function upsertEnvVar(projectId: string, key: string, value: string): void {
  const db = getDb();
  // Delete existing if present (upsert)
  db.delete(schema.envVars)
    .where(and(eq(schema.envVars.projectId, projectId), eq(schema.envVars.key, key)))
    .run();
  db.insert(schema.envVars)
    .values({
      id: crypto.randomUUID(),
      projectId,
      key,
      value,
      isBuildTime: false,
    })
    .run();
}
