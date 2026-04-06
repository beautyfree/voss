import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";

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
      .orderBy(schema.deployments.createdAt)
      .limit(1)
      .get();

    return { data: { ...project, latestDeployment: deployment ?? null } };
  })
  .delete("/:name", ({ params }) => {
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

    db.delete(schema.projects).where(eq(schema.projects.id, project.id)).run();
    return { data: { deleted: true } };
  });
