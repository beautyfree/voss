import { Elysia, t } from "elysia";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db";
import { stopContainer } from "../services/runner";
import { removeTraefikConfig } from "../services/traefik";
import { deleteProjectServices } from "../services/db-manager";
import { VOSS_LOG_DIR, VOSS_UPLOADS_DIR, VOSS_DATA_DIR } from "@voss/shared";
import { $ } from "bun";

export const projectRoutes = new Elysia({ prefix: "/api/projects" })
  .get("/", () => {
    const db = getDb();
    return { data: db.select().from(schema.projects).all() };
  })
  .get("/:name", ({ params }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: `Project '${params.name}' not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get latest deployment
    const deployment = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id))
      .orderBy(desc(schema.deployments.createdAt))
      .limit(1)
      .get();

    return { data: { ...project, latestDeployment: deployment ?? null } };
  })
  .patch("/:name", ({ params, body }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: `Project '${params.name}' not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const updates: Record<string, any> = {};
    if (body.repoUrl !== undefined) updates.repoUrl = body.repoUrl;
    if (body.notifyUrl !== undefined) updates.notifyUrl = body.notifyUrl;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString();
      db.update(schema.projects)
        .set(updates)
        .where(eq(schema.projects.id, project.id))
        .run();
    }

    return { data: { ...project, ...updates } };
  }, {
    body: t.Object({
      repoUrl: t.Optional(t.String()),
      notifyUrl: t.Optional(t.String()),
    }),
  })
  .delete("/:name", async ({ params }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: `Project '${params.name}' not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stop all containers for this project
    const deploys = db.select().from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id)).all();
    for (const d of deploys) {
      if (d.containerName) {
        try { await stopContainer(d.containerName); } catch (e) { console.error(`[delete] Failed to stop ${d.containerName}:`, (e as Error).message); }
      }
    }

    // Remove Traefik configs
    const aliases = db.select().from(schema.aliases)
      .where(eq(schema.aliases.projectId, project.id)).all();
    for (const a of aliases) {
      try { await removeTraefikConfig(a.subdomain); } catch (e) { console.error(`[delete] Failed to remove traefik ${a.subdomain}:`, (e as Error).message); }
    }
    try { await removeTraefikConfig(project.name); } catch (e) { console.error(`[delete] Failed to remove traefik ${project.name}:`, (e as Error).message); }

    // Delete database services (auto-backup before delete)
    try { await deleteProjectServices(project.id); } catch (e) { console.error("[delete] Failed to clean services:", (e as Error).message); }

    // Delete files: logs, uploads, cache
    try { await $`rm -rf ${VOSS_LOG_DIR}/${project.name}`.quiet(); } catch (e) { console.error("[delete] Failed to clean logs:", (e as Error).message); }
    try { await $`rm -rf ${VOSS_UPLOADS_DIR}/${project.name}`.quiet(); } catch (e) { console.error("[delete] Failed to clean uploads:", (e as Error).message); }
    try { await $`rm -rf ${VOSS_DATA_DIR}/cache/${project.name}`.quiet(); } catch (e) { console.error("[delete] Failed to clean cache:", (e as Error).message); }

    // Clean DB (order matters for foreign keys)
    db.delete(schema.events).where(eq(schema.events.projectId, project.id)).run();
    db.delete(schema.envVars).where(eq(schema.envVars.projectId, project.id)).run();
    db.delete(schema.domains).where(eq(schema.domains.projectId, project.id)).run();
    db.delete(schema.aliases).where(eq(schema.aliases.projectId, project.id)).run();
    db.delete(schema.deployments).where(eq(schema.deployments.projectId, project.id)).run();
    db.delete(schema.projects).where(eq(schema.projects.id, project.id)).run();

    return { data: { deleted: true, cleaned: { containers: deploys.length, aliases: aliases.length } } };
  });
