import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { getDb } from "./db";
import { projectRoutes } from "./routes/projects";
import { deployRoutes } from "./routes/deploy";
import { envRoutes } from "./routes/env";
import { domainRoutes } from "./routes/domains";
import { webhookRoutes } from "./routes/webhook";
import { healthRoutes } from "./routes/health";
import { eventRoutes } from "./routes/events";
import { dbRoutes } from "./routes/db";
import { wsRoutes } from "./routes/ws";
import { checkDependencies } from "./services/startup";
import { reconcileTraefikConfigs, writeDefaultMiddlewares } from "./services/traefik";
import { startSslChecker } from "./services/ssl-check";
import { startLogCleanup } from "./services/log-cleanup";
import { startMetricsCollector } from "./services/metrics-collector";
import { existsSync } from "fs";
import { join } from "path";

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

// Dashboard static files path
const DASH_DIR = join(import.meta.dir, "../../dashboard/dist");

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function getMime(path: string): string {
  const ext = path.substring(path.lastIndexOf("."));
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// Simple in-memory rate limiter
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 120; // requests per window
const RATE_WINDOW = 60_000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW };
    rateMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(ip);
  }
}, 5 * 60_000);

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
  // Rate limiting for API routes
  .onBeforeHandle(({ request, path }) => {
    if (!path.startsWith("/api/")) return;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? request.headers.get("x-real-ip")
      ?? "unknown";
    if (!checkRateLimit(ip)) {
      return Response.json(
        { code: "RATE_LIMITED", message: "Too many requests" },
        { status: 429 }
      );
    }
  })
  // Public routes (no auth)
  .use(healthRoutes)
  .use(wsRoutes)
  .use(webhookRoutes)
  // Auth middleware for API routes only
  .onBeforeHandle(({ headers, path }) => {
    if (!path.startsWith("/api/")) return;
    if (path === "/api/health") return;
    if (path === "/api/stats") return;
    if (path === "/api/db/status") return;
    if (path.startsWith("/api/webhook/")) return;
    const token = headers.authorization?.replace("Bearer ", "");
    if (token !== API_KEY) {
      return Response.json(
        { code: "UNAUTHORIZED", message: "Invalid API key" },
        { status: 401 }
      );
    }
  })
  .use(projectRoutes)
  .use(deployRoutes)
  .use(envRoutes)
  .use(domainRoutes)
  .use(eventRoutes)
  .use(dbRoutes)
  // Dashboard: serve static files from packages/dashboard/dist
  .get("/assets/*", ({ params }) => {
    const fileName = (params as any)["*"];
    const file = Bun.file(join(DASH_DIR, "assets", fileName));
    return new Response(file, {
      headers: { "Content-Type": getMime(fileName) },
    });
  })
  .get("/favicon.svg", () => new Response(Bun.file(join(DASH_DIR, "favicon.svg")), {
    headers: { "Content-Type": "image/svg+xml" },
  }))
  .get("/*", ({ path }) => {
    if (path.startsWith("/api/") || path.startsWith("/ws/")) return;

    // Try exact file
    const filePath = join(DASH_DIR, path);
    if (path !== "/" && existsSync(filePath)) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": getMime(path) },
      });
    }

    // SPA fallback
    const indexPath = join(DASH_DIR, "index.html");
    if (existsSync(indexPath)) {
      return new Response(Bun.file(indexPath), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Dashboard not built. Run: cd packages/dashboard && bun run build", {
      status: 404,
    });
  })
  .listen(PORT);

console.log(`voss-server running on :${PORT}`);
console.log(`Dashboard: http://localhost:${PORT}`);

// Background jobs
startSslChecker();       // SSL cert check every hour
startLogCleanup();       // Log + container cleanup every 6 hours
startMetricsCollector(); // Docker stats every 30s

export type App = typeof app;
