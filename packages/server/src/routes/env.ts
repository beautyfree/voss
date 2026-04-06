import { Elysia, t } from "elysia";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";

export const envRoutes = new Elysia({ prefix: "/api/projects/:name/env" })
  .get("/", ({ params }) => {
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

    const vars = db
      .select()
      .from(schema.envVars)
      .where(eq(schema.envVars.projectId, project.id))
      .all();

    // Mask values in response
    return {
      data: vars.map((v) => ({
        key: v.key,
        isBuildTime: v.isBuildTime,
        value: "••••••",
      })),
    };
  })
  .post("/", ({ params, body }) => {
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

    const { key, value, isBuildTime } = body as { key: string; value: string; isBuildTime?: boolean };
    const id = crypto.randomUUID();

    // Upsert: delete existing key first
    db.delete(schema.envVars)
      .where(
        and(eq(schema.envVars.projectId, project.id), eq(schema.envVars.key, key))
      )
      .run();

    db.insert(schema.envVars)
      .values({ id, projectId: project.id, key, value, isBuildTime: isBuildTime ?? false })
      .run();

    return { data: { key, set: true } };
  })
  .delete("/:key", ({ params }) => {
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

    db.delete(schema.envVars)
      .where(
        and(eq(schema.envVars.projectId, project.id), eq(schema.envVars.key, params.key))
      )
      .run();

    return { data: { key: params.key, deleted: true } };
  });
