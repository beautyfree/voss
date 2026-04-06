import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { VOSS_DB_PATH } from "@voss/shared";

let db: ReturnType<typeof createDb>;

function createDb(dbPath = VOSS_DB_PATH) {
  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

export function getDb(dbPath?: string) {
  if (!db) {
    db = createDb(dbPath);
  }
  return db;
}

function migrate(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      framework TEXT NOT NULL DEFAULT 'unknown',
      server_id TEXT NOT NULL DEFAULT 'local',
      domain TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      status TEXT NOT NULL DEFAULT 'queued',
      commit_sha TEXT,
      branch TEXT,
      runner_image TEXT NOT NULL,
      build_command TEXT NOT NULL,
      start_command TEXT NOT NULL,
      container_id TEXT,
      container_name TEXT,
      log_path TEXT,
      env_vars_snapshot TEXT NOT NULL DEFAULT '{}',
      config_snapshot TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS env_vars (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      is_build_time INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS aliases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      subdomain TEXT NOT NULL UNIQUE,
      deployment_id TEXT NOT NULL REFERENCES deployments(id),
      previous_deployment_id TEXT,
      type TEXT NOT NULL DEFAULT 'production'
    );

    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      hostname TEXT NOT NULL UNIQUE,
      ssl_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT ''
    );
  `);

  // Migrations for existing DBs
  try { sqlite.exec("ALTER TABLE projects ADD COLUMN repo_url TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE projects ADD COLUMN cache_hash TEXT"); } catch {}
}

// Reset for testing
export function resetDb() {
  db = undefined as any;
}

export { schema };
