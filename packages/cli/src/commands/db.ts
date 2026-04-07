import { requireCredentials, api } from "../lib/credentials";
import { existsSync } from "fs";
import { join } from "path";

export default async function db(args: string[]) {
  const creds = requireCredentials();
  const subcommand = args[0];

  if (!subcommand || subcommand === "help") {
    printHelp();
    return;
  }

  if (subcommand === "init") {
    return await dbInit(creds);
  }

  if (subcommand === "status") {
    return await dbStatus(creds);
  }

  if (subcommand === "create") {
    return await dbCreate(creds, args.slice(1));
  }

  if (subcommand === "connect") {
    return await dbConnect(creds, args.slice(1));
  }

  if (subcommand === "list" || subcommand === "ls") {
    return await dbList(creds, args.slice(1));
  }

  if (subcommand === "backup") {
    return await dbBackup(creds, args.slice(1));
  }

  if (subcommand === "restore") {
    return await dbRestore(creds, args.slice(1));
  }

  if (subcommand === "destroy" || subcommand === "rm") {
    return await dbDestroy(creds, args.slice(1));
  }

  if (subcommand === "url") {
    return await dbUrl(creds, args.slice(1));
  }

  console.error(`  Unknown db subcommand: ${subcommand}`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`
  voss db — Database management

  Commands:
    init                          Start shared Postgres + Redis on server
    status                        Show shared infrastructure status
    create [project] [flags]      Create database for project
    connect <provider> [--url]    Connect external provider
    list                          List databases for current project
    backup [project]              Create backup
    restore [project] [backupId]  Restore from backup
    destroy [project]             Delete database and data
    url [project]                 Show connection URL

  Flags:
    --isolated    Create isolated container (default: shared)
    --redis       Create Redis instead of Postgres
    --url URL     Connection URL for external provider

  Providers: neon, supabase, planetscale, upstash, turso
  `);
}

function getProjectName(args: string[]): string {
  // First non-flag arg is project name, or read from voss.json
  const explicit = args.find(a => !a.startsWith("--"));
  if (explicit) return explicit;

  const configPath = join(process.cwd(), "voss.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(require("fs").readFileSync(configPath, "utf-8"));
    return config.name;
  }

  return process.cwd().split("/").pop() ?? "app";
}

async function dbInit(creds: any) {
  console.log("  Initializing shared database infrastructure...");
  const resp = await api(creds, "/api/db/init", { method: "POST" });
  if (!resp.ok) {
    const err = await resp.json() as any;
    console.error(`  ✕ ${err.message ?? "Failed to initialize"}`);
    process.exit(1);
  }

  const { data } = await resp.json() as any;
  console.log(`  ✓ Shared Postgres: ${data.postgres?.running ? "running" : "starting"}`);
  console.log(`  ✓ Shared Redis: ${data.redis?.running ? "running" : "starting"}`);
}

async function dbStatus(creds: any) {
  const resp = await api(creds, "/api/db/status");
  if (!resp.ok) {
    console.error("  ✕ Could not fetch status");
    process.exit(1);
  }

  const { data } = await resp.json() as any;
  const pg = data.shared?.postgres;
  const rd = data.shared?.redis;

  console.log(`  Shared Infrastructure:`);
  console.log(`    Postgres: ${pg?.running ? "● running" : pg?.exists ? "○ stopped" : "— not initialized"}`);
  console.log(`    Redis:    ${rd?.running ? "● running" : rd?.exists ? "○ stopped" : "— not initialized"}`);
  console.log(`  Total services: ${data.totalServices}`);
}

async function dbCreate(creds: any, args: string[]) {
  const projectName = getProjectName(args);
  const isIsolated = args.includes("--isolated");
  const isRedis = args.includes("--redis");
  const type = isRedis ? "redis" : "postgres";
  const tier = isIsolated ? "isolated" : "shared";

  console.log(`  Creating ${tier} ${type} for ${projectName}...`);

  const resp = await api(creds, `/api/projects/${projectName}/services`, {
    method: "POST",
    body: JSON.stringify({ type, tier }),
  });

  if (!resp.ok) {
    const err = await resp.json() as any;
    console.error(`  ✕ ${err.message ?? "Failed to create service"}`);
    process.exit(1);
  }

  const { data } = await resp.json() as any;
  console.log(`  ✓ Created ${tier} ${type}`);
  if (data.envVars?.length) {
    console.log(`  Env vars injected: ${data.envVars.join(", ")}`);
  }
  console.log(`  Redeploy to use: voss deploy`);
}

async function dbConnect(creds: any, args: string[]) {
  const provider = args[0];
  if (!provider) {
    console.error("  Usage: voss db connect <provider> --url <connection-url>");
    console.error("  Providers: neon, supabase, planetscale, upstash, turso");
    process.exit(1);
  }

  const urlIdx = args.indexOf("--url");
  const connectionUrl = urlIdx >= 0 ? args[urlIdx + 1] : undefined;

  if (!connectionUrl) {
    console.error("  --url is required. Example:");
    console.error(`  voss db connect ${provider} --url "postgresql://user:pass@host/db"`);
    process.exit(1);
  }

  const projectName = getProjectName(args);
  console.log(`  Connecting ${provider} to ${projectName}...`);

  const resp = await api(creds, `/api/projects/${projectName}/services/connect`, {
    method: "POST",
    body: JSON.stringify({ provider, connectionUrl }),
  });

  if (!resp.ok) {
    const err = await resp.json() as any;
    console.error(`  ✕ ${err.message ?? "Failed to connect"}`);
    process.exit(1);
  }

  console.log(`  ✓ Connected ${provider}`);
  console.log(`  Redeploy to use: voss deploy`);
}

async function dbList(creds: any, args: string[]) {
  const projectName = getProjectName(args);
  const resp = await api(creds, `/api/projects/${projectName}/services`);

  if (!resp.ok) {
    const err = await resp.json() as any;
    if (err.code === "NOT_FOUND") {
      console.log(`  Project '${projectName}' not found`);
      return;
    }
    console.error("  ✕ Could not fetch services");
    process.exit(1);
  }

  const { data: services } = await resp.json() as any;

  if (!services.length) {
    console.log(`  No databases. Create one: voss db create`);
    return;
  }

  for (const s of services) {
    const status = s.containerStatus === "running" ? "●" : "○";
    const provider = s.provider ? ` (${s.provider})` : "";
    console.log(`  ${status} ${s.type} — ${s.tier}${provider} [${s.id.slice(0, 8)}]`);
  }
}

async function dbBackup(creds: any, args: string[]) {
  const projectName = getProjectName(args);
  const resp = await api(creds, `/api/projects/${projectName}/services`);
  if (!resp.ok) {
    console.error("  ✕ Could not fetch services");
    process.exit(1);
  }

  const { data: services } = await resp.json() as any;
  if (!services.length) {
    console.log("  No services to backup");
    return;
  }

  for (const s of services) {
    if (s.tier === "external") continue;
    console.log(`  Backing up ${s.type}...`);
    const backupResp = await api(creds, `/api/projects/${projectName}/services/${s.id}/backup`, {
      method: "POST",
    });

    if (!backupResp.ok) {
      const err = await backupResp.json() as any;
      console.error(`  ✕ ${s.type}: ${err.message}`);
      continue;
    }

    const { data: backup } = await backupResp.json() as any;
    const size = backup.sizeBytes ? ` (${Math.round(backup.sizeBytes / 1024)}KB)` : "";
    console.log(`  ✓ ${s.type} backed up${size}`);
  }
}

async function dbRestore(creds: any, args: string[]) {
  const projectName = getProjectName(args);
  const backupId = args.find(a => !a.startsWith("--") && a !== projectName);

  if (!backupId) {
    // List backups
    const resp = await api(creds, `/api/projects/${projectName}/services`);
    if (!resp.ok) { console.error("  ✕ Could not fetch services"); process.exit(1); }
    const { data: services } = await resp.json() as any;

    for (const s of services) {
      const bkResp = await api(creds, `/api/projects/${projectName}/services/${s.id}/backups`);
      if (!bkResp.ok) continue;
      const { data: backups } = await bkResp.json() as any;
      if (backups.length) {
        console.log(`  ${s.type} backups:`);
        for (const b of backups) {
          const size = b.sizeBytes ? ` (${Math.round(b.sizeBytes / 1024)}KB)` : "";
          console.log(`    ${b.id.slice(0, 8)} — ${b.type} — ${b.createdAt}${size}`);
        }
      }
    }
    console.log(`\n  Usage: voss db restore [project] <backupId>`);
    return;
  }

  // Find which service this backup belongs to
  const resp = await api(creds, `/api/projects/${projectName}/services`);
  if (!resp.ok) { console.error("  ✕ Could not fetch services"); process.exit(1); }
  const { data: services } = await resp.json() as any;

  for (const s of services) {
    const bkResp = await api(creds, `/api/projects/${projectName}/services/${s.id}/backups`);
    if (!bkResp.ok) continue;
    const { data: backups } = await bkResp.json() as any;
    const match = backups.find((b: any) => b.id.startsWith(backupId));
    if (match) {
      console.log(`  Restoring ${s.type} from backup ${match.id.slice(0, 8)}...`);
      const restoreResp = await api(creds, `/api/projects/${projectName}/services/${s.id}/restore/${match.id}`, {
        method: "POST",
      });
      if (!restoreResp.ok) {
        const err = await restoreResp.json() as any;
        console.error(`  ✕ ${err.message}`);
        process.exit(1);
      }
      console.log(`  ✓ Restored`);
      return;
    }
  }

  console.error(`  ✕ Backup ${backupId} not found`);
  process.exit(1);
}

async function dbDestroy(creds: any, args: string[]) {
  const projectName = getProjectName(args);
  const resp = await api(creds, `/api/projects/${projectName}/services`);
  if (!resp.ok) { console.error("  ✕ Could not fetch services"); process.exit(1); }
  const { data: services } = await resp.json() as any;

  if (!services.length) {
    console.log("  No services to destroy");
    return;
  }

  for (const s of services) {
    console.log(`  Destroying ${s.type} (${s.tier})...`);
    const delResp = await api(creds, `/api/projects/${projectName}/services/${s.id}`, {
      method: "DELETE",
    });
    if (!delResp.ok) {
      const err = await delResp.json() as any;
      console.error(`  ✕ ${s.type}: ${err.message}`);
      continue;
    }
    console.log(`  ✓ ${s.type} destroyed (backup saved)`);
  }
}

async function dbUrl(creds: any, args: string[]) {
  const projectName = getProjectName(args);
  const resp = await api(creds, `/api/projects/${projectName}/env`);
  if (!resp.ok) { console.error("  ✕ Could not fetch env vars"); process.exit(1); }
  const { data: vars } = await resp.json() as any;

  const dbVars = vars.filter((v: any) =>
    v.key === "DATABASE_URL" || v.key === "REDIS_URL"
  );

  if (!dbVars.length) {
    console.log("  No database URLs found. Create one: voss db create");
    return;
  }

  for (const v of dbVars) {
    console.log(`  ${v.key}=${v.value}`);
  }
}
