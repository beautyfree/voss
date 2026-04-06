import { Elysia } from "elysia";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db";

export const eventRoutes = new Elysia({ prefix: "/api/projects/:name/events" })
  .get("/", ({ params, query }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Project not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const limit = Number(query?.limit) || 50;
    const events = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.projectId, project.id))
      .orderBy(desc(schema.events.createdAt))
      .limit(limit)
      .all();

    return { data: events };
  });
