import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { getDb } from "./db";
import { projectRoutes } from "./routes/projects";
import { deployRoutes } from "./routes/deploy";
import { envRoutes } from "./routes/env";
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

// Reconcile Traefik state from DB
await writeDefaultMiddlewares();
await reconcileTraefikConfigs();
console.log("Traefik configs reconciled.");

const app = new Elysia()
  .use(cors())
  // Auth middleware
  .derive(({ headers }) => {
    const token = headers.authorization?.replace("Bearer ", "");
    if (token !== API_KEY) {
      throw new Error("UNAUTHORIZED");
    }
    return {};
  })
  .onError(({ error }) => {
    if (error.message === "UNAUTHORIZED") {
      return new Response(
        JSON.stringify({ code: "UNAUTHORIZED", message: "Invalid API key" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ code: "SERVER_ERROR", message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  })
  .use(healthRoutes)
  .use(wsRoutes)
  .use(projectRoutes)
  .use(deployRoutes)
  .use(envRoutes)
  .listen(PORT);

console.log(`voss-server running on :${PORT}`);

export type App = typeof app;
