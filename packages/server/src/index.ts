import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { getDb } from "./db";
import { projectRoutes } from "./routes/projects";
import { deployRoutes } from "./routes/deploy";
import { envRoutes } from "./routes/env";
import { domainRoutes } from "./routes/domains";
import { webhookRoutes } from "./routes/webhook";
import { healthRoutes } from "./routes/health";
import { wsRoutes } from "./routes/ws";
import { checkDependencies } from "./services/startup";
import { reconcileTraefikConfigs, writeDefaultMiddlewares } from "./services/traefik";

const PORT = Number(process.env.PORT) || 3456;
const API_KEY = process.env.VOSS_API_KEY;

if (!API_KEY) {
  console.error("VOSS_API_KEY environment variable is required");
  process.exit(1);
}

// Startup health checks
await checkDependencies();

// Initialize database
getDb();

// Reconcile Traefik state from DB (non-fatal)
try {
  await writeDefaultMiddlewares();
  await reconcileTraefikConfigs();
  console.log("Traefik configs reconciled.");
} catch (err) {
  console.log("⚠ Traefik reconciliation skipped:", (err as Error).message);
}

const app = new Elysia({
    serve: {
      maxRequestBodySize: 512 * 1024 * 1024, // 512MB
    },
  })
  .use(cors())
  .onError(({ error }) => {
    return Response.json(
      { code: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  })
  // Public routes (no auth)
  .use(healthRoutes)
  .use(wsRoutes)
  .use(webhookRoutes)
  // Auth middleware for API routes
  .onBeforeHandle(({ headers, path }) => {
    // Skip auth for public routes
    if (path === "/api/health" || path.startsWith("/ws/")) return;
    const token = headers.authorization?.replace("Bearer ", "");
    if (token !== API_KEY) {
      return Response.json(
        { code: "UNAUTHORIZED", message: "Invalid API key" },
        { status: 401 }
      );
    }
    // Return nothing = pass through
  })
  .use(projectRoutes)
  .use(deployRoutes)
  .use(envRoutes)
  .use(domainRoutes)
  .listen(PORT);

console.log(`voss-server running on :${PORT}`);

export type App = typeof app;
