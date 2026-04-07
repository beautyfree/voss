import { Elysia, t } from "elysia";
import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
  validateConnectionUrl,
  validateProjectName,
  type ServiceProvider,
  type ServiceType,
  DB_ENV_KEYS,
  SHARED_CONTAINERS,
} from "@voss/shared";
import {
  initSharedPostgres,
  initSharedRedis,
  createSharedPostgresDb,
  createSharedRedis,
  createIsolatedService,
  connectExternalService,
  deleteService,
  backupService,
  restoreService,
  getSharedStatus,
} from "../services/db-manager";
import { inspectContainer } from "../services/docker-utils";

const SERVICE_TYPES = ["postgres", "redis"] as const;
const SERVICE_TIERS = ["shared", "isolated", "external"] as const;
const PROVIDERS = ["neon", "supabase", "planetscale", "upstash", "turso"] as const;

export const dbRoutes = new Elysia({ prefix: "/api" })
  // ── System-level: shared infrastructure ──

  .post("/db/init", async () => {
    try {
      await Promise.all([initSharedPostgres(), initSharedRedis()]);
      const status = await getSharedStatus();
      return { data: { initialized: true, ...status } };
    } catch (e) {
      return new Response(
        JSON.stringify({ code: "SERVER_ERROR", message: (e as Error).message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  })

  .get("/db/status", async () => {
    const status = await getSharedStatus();
    const db = getDb();
    const serviceCount = db.select().from(schema.services).all().length;
    return {
      data: {
        shared: status,
        totalServices: serviceCount,
      },
    };
  })

  // ── Project-level: services CRUD ──

  .get("/projects/:name/services", ({ params }) => {
    const db = getDb();
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.name, params.name)).get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: `Project '${params.name}' not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const services = db.select().from(schema.services)
      .where(eq(schema.services.projectId, project.id)).all();

    return { data: services };
  })

  .post("/projects/:name/services", async ({ params, body }) => {
    const db = getDb();
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.name, params.name)).get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: `Project '${params.name}' not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const { type, tier, version } = body;

    // Check for duplicate
    const existing = db.select().from(schema.services)
      .where(and(
        eq(schema.services.projectId, project.id),
        eq(schema.services.type, type),
      )).get();

    if (existing) {
      return new Response(
        JSON.stringify({ code: "INVALID_CONFIG", message: `Service ${type} already exists for this project` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      let envVars: Record<string, string> = {};

      if (tier === "shared") {
        if (type === "postgres") {
          envVars = await createSharedPostgresDb(params.name, project.id);
        } else {
          envVars = await createSharedRedis(params.name, project.id);
        }
      } else if (tier === "isolated") {
        envVars = await createIsolatedService(params.name, project.id, type as ServiceType, { version });
      } else {
        return new Response(
          JSON.stringify({ code: "INVALID_CONFIG", message: "Use /services/connect for external providers" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const service = db.select().from(schema.services)
        .where(and(
          eq(schema.services.projectId, project.id),
          eq(schema.services.type, type),
        )).get();

      return { data: { service, envVars: Object.keys(envVars) } };
    } catch (e) {
      return new Response(
        JSON.stringify({ code: "SERVER_ERROR", message: (e as Error).message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }, {
    body: t.Object({
      type: t.Union([t.Literal("postgres"), t.Literal("redis")]),
      tier: t.Union([t.Literal("shared"), t.Literal("isolated")]),
      version: t.Optional(t.String()),
    }),
  })

  // Connect external provider
  .post("/projects/:name/services/connect", async ({ params, body }) => {
    const db = getDb();
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.name, params.name)).get();

    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: `Project '${params.name}' not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const { provider, connectionUrl } = body;

    // Validate URL
    const urlErr = validateConnectionUrl(provider as ServiceProvider, connectionUrl);
    if (urlErr) {
      return new Response(
        JSON.stringify({ code: "INVALID_CONFIG", message: urlErr }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Determine service type from provider
    const type: ServiceType = (provider === "upstash") ? "redis" : "postgres";

    // Check for duplicate
    const existing = db.select().from(schema.services)
      .where(and(
        eq(schema.services.projectId, project.id),
        eq(schema.services.type, type),
      )).get();

    if (existing) {
      return new Response(
        JSON.stringify({ code: "INVALID_CONFIG", message: `Service ${type} already exists for this project` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      await connectExternalService(project.id, type, provider as ServiceProvider, connectionUrl);

      const service = db.select().from(schema.services)
        .where(and(
          eq(schema.services.projectId, project.id),
          eq(schema.services.type, type),
        )).get();

      return { data: { service } };
    } catch (e) {
      return new Response(
        JSON.stringify({ code: "SERVER_ERROR", message: (e as Error).message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }, {
    body: t.Object({
      provider: t.Union([
        t.Literal("neon"), t.Literal("supabase"), t.Literal("planetscale"),
        t.Literal("upstash"), t.Literal("turso"),
      ]),
      connectionUrl: t.String(),
    }),
  })

  // Delete service
  .delete("/projects/:name/services/:serviceId", async ({ params }) => {
    const db = getDb();
    const service = db.select().from(schema.services)
      .where(eq(schema.services.id, params.serviceId)).get();

    if (!service) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Service not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      await deleteService(params.serviceId);
      return { data: { deleted: true } };
    } catch (e) {
      return new Response(
        JSON.stringify({ code: "SERVER_ERROR", message: (e as Error).message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  })

  // Service status (live container check)
  .get("/projects/:name/services/:serviceId/status", async ({ params }) => {
    const db = getDb();
    const service = db.select().from(schema.services)
      .where(eq(schema.services.id, params.serviceId)).get();

    if (!service) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Service not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    let containerStatus = service.containerStatus;
    if (service.containerName) {
      const { exists, running } = await inspectContainer(service.containerName);
      containerStatus = !exists ? "stopped" : running ? "running" : "stopped";
    }

    return { data: { ...service, containerStatus } };
  })

  // Create backup
  .post("/projects/:name/services/:serviceId/backup", async ({ params }) => {
    try {
      const backupId = await backupService(params.serviceId);
      const db = getDb();
      const backup = db.select().from(schema.serviceBackups)
        .where(eq(schema.serviceBackups.id, backupId)).get();
      return { data: backup };
    } catch (e) {
      return new Response(
        JSON.stringify({ code: "SERVER_ERROR", message: (e as Error).message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  })

  // List backups
  .get("/projects/:name/services/:serviceId/backups", ({ params }) => {
    const db = getDb();
    const backups = db.select().from(schema.serviceBackups)
      .where(eq(schema.serviceBackups.serviceId, params.serviceId))
      .orderBy(desc(schema.serviceBackups.createdAt))
      .all();
    return { data: backups };
  })

  // Restore from backup
  .post("/projects/:name/services/:serviceId/restore/:backupId", async ({ params }) => {
    try {
      await restoreService(params.serviceId, params.backupId);
      return { data: { restored: true } };
    } catch (e) {
      return new Response(
        JSON.stringify({ code: "SERVER_ERROR", message: (e as Error).message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  });
