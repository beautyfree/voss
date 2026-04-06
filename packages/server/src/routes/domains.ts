import { Elysia } from "elysia";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import { updateTraefikConfig } from "../services/traefik";
import { RUNNERS } from "@voss/shared";

export const domainRoutes = new Elysia({ prefix: "/api/projects/:name/domains" })
  .get("/", ({ params }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return Response.json({ code: "NOT_FOUND", message: "Project not found" }, { status: 404 });
    }

    const domains = db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.projectId, project.id))
      .all();

    return { data: domains };
  })

  .post("/", async ({ params, body }) => {
    const db = getDb();
    const { hostname } = body as { hostname: string };

    if (!hostname || typeof hostname !== "string") {
      return Response.json({ code: "INVALID_CONFIG", message: "hostname is required" }, { status: 400 });
    }

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return Response.json({ code: "NOT_FOUND", message: "Project not found" }, { status: 404 });
    }

    // Check if domain already exists
    const existing = db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.hostname, hostname))
      .get();

    if (existing) {
      return Response.json({ code: "INVALID_CONFIG", message: `Domain '${hostname}' already in use` }, { status: 409 });
    }

    // Create domain record
    const id = crypto.randomUUID();
    db.insert(schema.domains)
      .values({
        id,
        projectId: project.id,
        hostname,
        sslStatus: "pending",
        createdAt: new Date().toISOString(),
      })
      .run();

    // Update Traefik config with the new domain
    const alias = db
      .select()
      .from(schema.aliases)
      .where(eq(schema.aliases.projectId, project.id))
      .get();

    if (alias) {
      const deployment = db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.id, alias.deploymentId))
        .get();

      if (deployment?.containerName) {
        const allDomains = db
          .select()
          .from(schema.domains)
          .where(eq(schema.domains.projectId, project.id))
          .all();

        const runner = RUNNERS[project.framework as keyof typeof RUNNERS] ?? RUNNERS.node;

        await updateTraefikConfig({
          projectName: project.name,
          containerName: deployment.containerName,
          port: runner.port,
          domains: allDomains.map((d) => d.hostname),
        });
      }
    }

    // Get server IP for DNS instructions
    const serverIp = process.env.VOSS_DOMAIN ?? "your-server-ip";

    return {
      data: {
        id,
        hostname,
        sslStatus: "pending",
        dnsInstruction: `Set DNS A record: ${hostname} → ${serverIp}`,
      },
    };
  })

  .delete("/:hostname", async ({ params }) => {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.name, params.name))
      .get();

    if (!project) {
      return Response.json({ code: "NOT_FOUND", message: "Project not found" }, { status: 404 });
    }

    db.delete(schema.domains)
      .where(
        and(
          eq(schema.domains.projectId, project.id),
          eq(schema.domains.hostname, params.hostname)
        )
      )
      .run();

    // Regenerate Traefik config without this domain
    const alias = db
      .select()
      .from(schema.aliases)
      .where(eq(schema.aliases.projectId, project.id))
      .get();

    if (alias) {
      const deployment = db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.id, alias.deploymentId))
        .get();

      if (deployment?.containerName) {
        const remainingDomains = db
          .select()
          .from(schema.domains)
          .where(eq(schema.domains.projectId, project.id))
          .all();

        const runner = RUNNERS[project.framework as keyof typeof RUNNERS] ?? RUNNERS.node;

        await updateTraefikConfig({
          projectName: project.name,
          containerName: deployment.containerName,
          port: runner.port,
          domains: remainingDomains.map((d) => d.hostname),
        });
      }
    }

    return { data: { hostname: params.hostname, deleted: true } };
  });
