import { Elysia, t } from "elysia";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import { logEvent } from "../services/events";
import { validateEnvKey } from "@voss/shared";

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
    const keyErr = validateEnvKey(body.key);
    if (keyErr) {
      return new Response(
        JSON.stringify({ code: "INVALID_CONFIG", message: keyErr }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

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

    const id = crypto.randomUUID();

    // Upsert: delete existing key first
    db.delete(schema.envVars)
      .where(
        and(eq(schema.envVars.projectId, project.id), eq(schema.envVars.key, body.key))
      )
      .run();

    db.insert(schema.envVars)
      .values({ id, projectId: project.id, key: body.key, value: body.value, isBuildTime: body.isBuildTime ?? false })
      .run();

    logEvent(project.id, "env_set", `Set ${body.key}`, { key: body.key });
    return { data: { key: body.key, set: true } };
  }, {
    body: t.Object({
      key: t.String(),
      value: t.String(),
      isBuildTime: t.Optional(t.Boolean()),
    }),
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

    logEvent(project.id, "env_delete", `Deleted ${params.key}`, { key: params.key });
    return { data: { key: params.key, deleted: true } };
  });
