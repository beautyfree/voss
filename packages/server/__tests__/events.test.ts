import { describe, test, expect, beforeEach } from "bun:test";
import { getDb, resetDb, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/voss-test-events.db";

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

describe("events", () => {
  test("creates events table", () => {
    const db = testDb();
    const events = db.select().from(schema.events).all();
    expect(events).toEqual([]);
  });

  test("inserts and retrieves events", () => {
    const db = testDb();
    const projectId = createProject(db);

    db.insert(schema.events).values({
      id: crypto.randomUUID(),
      projectId,
      type: "deploy",
      message: "Deployed test-app",
      meta: JSON.stringify({ deploymentId: "abc123" }),
      createdAt: new Date().toISOString(),
    }).run();

    db.insert(schema.events).values({
      id: crypto.randomUUID(),
      projectId,
      type: "env_set",
      message: "Set DATABASE_URL",
      createdAt: new Date().toISOString(),
    }).run();

    const events = db.select().from(schema.events)
      .where(eq(schema.events.projectId, projectId)).all();

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("deploy");
    expect(events[1].type).toBe("env_set");
  });
});

describe("env vars", () => {
  test("inserts and masks values", () => {
    const db = testDb();
    const projectId = createProject(db);

    db.insert(schema.envVars).values({
      id: crypto.randomUUID(),
      projectId,
      key: "SECRET",
      value: "supersecret123",
      isBuildTime: false,
    }).run();

    const vars = db.select().from(schema.envVars)
      .where(eq(schema.envVars.projectId, projectId)).all();

    expect(vars).toHaveLength(1);
    expect(vars[0].key).toBe("SECRET");
    expect(vars[0].value).toBe("supersecret123"); // raw value in DB
  });

  test("upsert replaces existing key", () => {
    const db = testDb();
    const projectId = createProject(db);

    // Insert first
    db.insert(schema.envVars).values({
      id: crypto.randomUUID(), projectId, key: "KEY", value: "v1", isBuildTime: false,
    }).run();

    // Upsert: delete + insert
    db.delete(schema.envVars).where(
      eq(schema.envVars.key, "KEY"),
    ).run();
    db.insert(schema.envVars).values({
      id: crypto.randomUUID(), projectId, key: "KEY", value: "v2", isBuildTime: true,
    }).run();

    const vars = db.select().from(schema.envVars)
      .where(eq(schema.envVars.projectId, projectId)).all();

    expect(vars).toHaveLength(1);
    expect(vars[0].value).toBe("v2");
    expect(vars[0].isBuildTime).toBe(true);
  });
});

describe("project delete cascade", () => {
  test("deleting project cleans up related records", () => {
    const db = testDb();
    const projectId = createProject(db);

    // Add related records
    const deployId = crypto.randomUUID();
    db.insert(schema.deployments).values({
      id: deployId, projectId, status: "live",
      runnerImage: "node:20", buildCommand: "npm build", startCommand: "npm start",
      createdAt: new Date().toISOString(),
    }).run();

    db.insert(schema.envVars).values({
      id: crypto.randomUUID(), projectId, key: "A", value: "1", isBuildTime: false,
    }).run();

    db.insert(schema.aliases).values({
      id: crypto.randomUUID(), projectId, subdomain: "test-app",
      deploymentId: deployId, type: "production",
    }).run();

    db.insert(schema.domains).values({
      id: crypto.randomUUID(), projectId, hostname: "test.com",
      sslStatus: "pending", createdAt: new Date().toISOString(),
    }).run();

    db.insert(schema.events).values({
      id: crypto.randomUUID(), projectId, type: "deploy",
      message: "test", createdAt: new Date().toISOString(),
    }).run();

    // Delete in correct order (foreign keys)
    db.delete(schema.events).where(eq(schema.events.projectId, projectId)).run();
    db.delete(schema.envVars).where(eq(schema.envVars.projectId, projectId)).run();
    db.delete(schema.domains).where(eq(schema.domains.projectId, projectId)).run();
    db.delete(schema.aliases).where(eq(schema.aliases.projectId, projectId)).run();
    db.delete(schema.deployments).where(eq(schema.deployments.projectId, projectId)).run();
    db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();

    // Verify all gone
    expect(db.select().from(schema.projects).all()).toHaveLength(0);
    expect(db.select().from(schema.deployments).all()).toHaveLength(0);
    expect(db.select().from(schema.envVars).all()).toHaveLength(0);
    expect(db.select().from(schema.aliases).all()).toHaveLength(0);
    expect(db.select().from(schema.domains).all()).toHaveLength(0);
    expect(db.select().from(schema.events).all()).toHaveLength(0);
  });
});

describe("project repoUrl", () => {
  test("stores and retrieves repoUrl", () => {
    const db = testDb();
    const projectId = createProject(db);

    db.update(schema.projects)
      .set({ repoUrl: "https://github.com/user/repo" })
      .where(eq(schema.projects.id, projectId))
      .run();

    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();

    expect(project!.repoUrl).toBe("https://github.com/user/repo");
  });

  test("stores notifyUrl", () => {
    const db = testDb();
    const projectId = createProject(db);

    db.update(schema.projects)
      .set({ notifyUrl: "https://hooks.slack.com/test" })
      .where(eq(schema.projects.id, projectId))
      .run();

    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();

    expect(project!.notifyUrl).toBe("https://hooks.slack.com/test");
  });
});
