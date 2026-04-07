import { describe, test, expect, beforeEach } from "bun:test";
import { getDb, resetDb, schema } from "../src/db";
import { eq, and } from "drizzle-orm";
import { unlinkSync, existsSync } from "fs";
import { parseConfig } from "@voss/shared";

const TEST_DB = "/tmp/voss-test-db-services.db";

beforeEach(() => {
  resetDb();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

function testDb() {
  return getDb(TEST_DB);
}

function createProject(db: any, name = "test-app") {
  const id = crypto.randomUUID();
  db.insert(schema.projects).values({
    id, name, framework: "nextjs",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();
  return id;
}

// ── Schema Tests ──

describe("services table", () => {
  test("creates services table", () => {
    const db = testDb();
    const services = db.select().from(schema.services).all();
    expect(services).toEqual([]);
  });

  test("creates service_backups table", () => {
    const db = testDb();
    const backups = db.select().from(schema.serviceBackups).all();
    expect(backups).toEqual([]);
  });

  test("inserts and retrieves a service", () => {
    const db = testDb();
    const projectId = createProject(db);
    const serviceId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.services).values({
      id: serviceId,
      projectId,
      type: "postgres",
      tier: "shared",
      containerName: "voss-shared-postgres",
      containerStatus: "running",
      dbName: "voss_test_app",
      envKey: "DATABASE_URL",
      port: 5432,
      config: "{}",
      createdAt: now,
      updatedAt: now,
    }).run();

    const services = db.select().from(schema.services)
      .where(eq(schema.services.projectId, projectId)).all();
    expect(services).toHaveLength(1);
    expect(services[0].type).toBe("postgres");
    expect(services[0].tier).toBe("shared");
    expect(services[0].containerStatus).toBe("running");
    expect(services[0].dbName).toBe("voss_test_app");
  });

  test("inserts backup record", () => {
    const db = testDb();
    const projectId = createProject(db);
    const serviceId = crypto.randomUUID();
    const backupId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.services).values({
      id: serviceId, projectId, type: "postgres", tier: "shared",
      config: "{}", createdAt: now, updatedAt: now,
    }).run();

    db.insert(schema.serviceBackups).values({
      id: backupId,
      serviceId,
      filePath: "/var/voss/backups/db/test.sql.gz",
      sizeBytes: 1024,
      type: "manual",
      createdAt: now,
    }).run();

    const backups = db.select().from(schema.serviceBackups)
      .where(eq(schema.serviceBackups.serviceId, serviceId)).all();
    expect(backups).toHaveLength(1);
    expect(backups[0].filePath).toBe("/var/voss/backups/db/test.sql.gz");
    expect(backups[0].sizeBytes).toBe(1024);
  });

  test("cascade: project delete removes services", () => {
    const db = testDb();
    const projectId = createProject(db);
    const serviceId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.services).values({
      id: serviceId, projectId, type: "redis", tier: "isolated",
      containerName: "voss-db-test-app-redis", containerStatus: "running",
      config: "{}", createdAt: now, updatedAt: now,
    }).run();

    // Delete project (must delete services first due to FK)
    db.delete(schema.services).where(eq(schema.services.projectId, projectId)).run();
    db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();

    const services = db.select().from(schema.services).all();
    expect(services).toHaveLength(0);
  });

  test("multiple services per project", () => {
    const db = testDb();
    const projectId = createProject(db);
    const now = new Date().toISOString();

    db.insert(schema.services).values({
      id: crypto.randomUUID(), projectId, type: "postgres", tier: "shared",
      envKey: "DATABASE_URL", config: "{}", createdAt: now, updatedAt: now,
    }).run();

    db.insert(schema.services).values({
      id: crypto.randomUUID(), projectId, type: "redis", tier: "shared",
      envKey: "REDIS_URL", config: "{}", createdAt: now, updatedAt: now,
    }).run();

    const services = db.select().from(schema.services)
      .where(eq(schema.services.projectId, projectId)).all();
    expect(services).toHaveLength(2);
    expect(services.map(s => s.type).sort()).toEqual(["postgres", "redis"]);
  });

  test("external service with provider", () => {
    const db = testDb();
    const projectId = createProject(db);
    const now = new Date().toISOString();

    db.insert(schema.services).values({
      id: crypto.randomUUID(), projectId, type: "postgres", tier: "external",
      provider: "neon", envKey: "DATABASE_URL",
      config: "{}", createdAt: now, updatedAt: now,
    }).run();

    const svc = db.select().from(schema.services)
      .where(and(eq(schema.services.projectId, projectId), eq(schema.services.tier, "external"))).get();
    expect(svc).toBeDefined();
    expect(svc!.provider).toBe("neon");
    expect(svc!.containerName).toBeNull();
  });

  test("service status update", () => {
    const db = testDb();
    const projectId = createProject(db);
    const serviceId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.services).values({
      id: serviceId, projectId, type: "postgres", tier: "isolated",
      containerName: "voss-db-test-pg", containerStatus: "running",
      config: "{}", createdAt: now, updatedAt: now,
    }).run();

    db.update(schema.services)
      .set({ containerStatus: "stopped", updatedAt: new Date().toISOString() })
      .where(eq(schema.services.id, serviceId)).run();

    const svc = db.select().from(schema.services)
      .where(eq(schema.services.id, serviceId)).get();
    expect(svc!.containerStatus).toBe("stopped");
  });
});

// ── Config Parsing Tests ──

describe("voss.json services parsing", () => {
  test("parses services.postgres: true", () => {
    const config = parseConfig({ name: "my-app", services: { postgres: true } });
    expect(config.services).toBeDefined();
    expect(config.services!.postgres).toBe(true);
  });

  test("parses services.postgres with config", () => {
    const config = parseConfig({
      name: "my-app",
      services: { postgres: { version: "15", tier: "isolated", memory: "1g" } },
    });
    expect(config.services!.postgres).toEqual({ version: "15", tier: "isolated", memory: "1g" });
  });

  test("parses services.redis: true", () => {
    const config = parseConfig({ name: "my-app", services: { redis: true } });
    expect(config.services!.redis).toBe(true);
  });

  test("parses both postgres and redis", () => {
    const config = parseConfig({
      name: "my-app",
      services: { postgres: true, redis: { version: "7" } },
    });
    expect(config.services!.postgres).toBe(true);
    expect(config.services!.redis).toEqual({ version: "7" });
  });

  test("rejects unknown service type", () => {
    expect(() => parseConfig({ name: "my-app", services: { mongodb: true } })).toThrow("Unknown service type");
  });

  test("rejects invalid tier", () => {
    expect(() => parseConfig({
      name: "my-app", services: { postgres: { tier: "mega" } },
    })).toThrow("'services.postgres.tier' must be 'shared' or 'isolated'");
  });

  test("rejects invalid services value", () => {
    expect(() => parseConfig({ name: "my-app", services: { postgres: "yes" } })).toThrow("must be true or a config object");
  });

  test("no services field returns undefined", () => {
    const config = parseConfig({ name: "my-app" });
    expect(config.services).toBeUndefined();
  });
});

// ── Validation Tests ──

describe("connection URL validation", () => {
  // Import dynamically to ensure it picks up constants
  const { validateConnectionUrl } = require("@voss/shared");

  test("accepts valid neon URL", () => {
    const result = validateConnectionUrl("neon", "postgresql://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/dbname");
    expect(result).toBeNull();
  });

  test("rejects invalid neon URL", () => {
    const result = validateConnectionUrl("neon", "postgresql://user:pass@localhost:5432/db");
    expect(result).toContain("Invalid neon connection URL");
  });

  test("accepts valid supabase URL", () => {
    const result = validateConnectionUrl("supabase", "postgresql://postgres:pass@db.abcdef123456.supabase.co:5432/postgres");
    expect(result).toBeNull();
  });

  test("accepts valid upstash URL", () => {
    const result = validateConnectionUrl("upstash", "redis://default:pass@us1-cool-name-12345.upstash.io:6379");
    expect(result).toBeNull();
  });

  test("accepts valid turso URL", () => {
    const result = validateConnectionUrl("turso", "libsql://mydb-user.turso.io");
    expect(result).toBeNull();
  });

  test("rejects empty URL", () => {
    const result = validateConnectionUrl("neon", "");
    expect(result).toBeTruthy();
  });

  test("rejects unknown provider", () => {
    const result = validateConnectionUrl("unknown" as any, "postgresql://localhost/db");
    expect(result).toContain("Unknown provider");
  });
});
