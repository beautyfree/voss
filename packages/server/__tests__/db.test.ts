import { describe, test, expect, beforeEach } from "bun:test";
import { getDb, resetDb, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/voss-test.db";

beforeEach(() => {
  resetDb();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(TEST_DB + "-wal")) unlinkSync(TEST_DB + "-wal");
  if (existsSync(TEST_DB + "-shm")) unlinkSync(TEST_DB + "-shm");
});

function testDb() {
  return getDb(TEST_DB);
}

describe("database", () => {
  test("creates tables on init", () => {
    const db = testDb();
    // Should not throw
    const projects = db.select().from(schema.projects).all();
    expect(projects).toEqual([]);
  });

  test("inserts and retrieves a project", () => {
    const db = testDb();
    const id = crypto.randomUUID();

    db.insert(schema.projects)
      .values({
        id,
        name: "test-app",
        framework: "nextjs",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    expect(project).not.toBeNull();
    expect(project!.name).toBe("test-app");
    expect(project!.framework).toBe("nextjs");
  });

  test("enforces unique project names", () => {
    const db = testDb();

    db.insert(schema.projects)
      .values({
        id: crypto.randomUUID(),
        name: "unique-app",
        framework: "node",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    expect(() => {
      db.insert(schema.projects)
        .values({
          id: crypto.randomUUID(),
          name: "unique-app",
          framework: "node",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();
    }).toThrow();
  });

  test("creates deployment with snapshot", () => {
    const db = testDb();
    const projectId = crypto.randomUUID();
    const deployId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({
        id: projectId,
        name: "snap-app",
        framework: "vite",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const envSnapshot = JSON.stringify({ DATABASE_URL: "postgres://..." });
    const configSnapshot = JSON.stringify({ name: "snap-app", framework: "vite" });

    db.insert(schema.deployments)
      .values({
        id: deployId,
        projectId,
        status: "live",
        runnerImage: "node:20-slim",
        buildCommand: "npm run build",
        startCommand: "npm start",
        envVarsSnapshot: envSnapshot,
        configSnapshot,
        createdAt: new Date().toISOString(),
      })
      .run();

    const deploy = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.id, deployId))
      .get();

    expect(deploy).not.toBeNull();
    expect(JSON.parse(deploy!.envVarsSnapshot)).toEqual({ DATABASE_URL: "postgres://..." });
    expect(JSON.parse(deploy!.configSnapshot).framework).toBe("vite");
  });

  test("alias swap for rollback", () => {
    const db = testDb();
    const projectId = crypto.randomUUID();
    const deploy1 = crypto.randomUUID();
    const deploy2 = crypto.randomUUID();
    const aliasId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({ id: projectId, name: "rollback-app", framework: "node", createdAt: "", updatedAt: "" })
      .run();

    db.insert(schema.deployments)
      .values({ id: deploy1, projectId, status: "live", runnerImage: "node:20", buildCommand: "", startCommand: "", createdAt: "" })
      .run();

    db.insert(schema.deployments)
      .values({ id: deploy2, projectId, status: "live", runnerImage: "node:20", buildCommand: "", startCommand: "", createdAt: "" })
      .run();

    // Create alias pointing to deploy2, previous = deploy1
    db.insert(schema.aliases)
      .values({ id: aliasId, projectId, subdomain: "rollback-app", deploymentId: deploy2, previousDeploymentId: deploy1, type: "production" })
      .run();

    // Rollback: swap deploymentId and previousDeploymentId
    db.update(schema.aliases)
      .set({ deploymentId: deploy1, previousDeploymentId: deploy2 })
      .where(eq(schema.aliases.id, aliasId))
      .run();

    const alias = db.select().from(schema.aliases).where(eq(schema.aliases.id, aliasId)).get();
    expect(alias!.deploymentId).toBe(deploy1);
    expect(alias!.previousDeploymentId).toBe(deploy2);
  });
});
