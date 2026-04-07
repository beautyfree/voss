import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  framework: text("framework").notNull().default("unknown"),
  serverId: text("server_id").notNull().default("local"),
  domain: text("domain"),
  repoUrl: text("repo_url"),
  notifyUrl: text("notify_url"), // Slack/Telegram/Discord webhook URL
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  status: text("status").notNull().default("queued"),
  commitSha: text("commit_sha"),
  branch: text("branch"),
  runnerImage: text("runner_image").notNull(),
  buildCommand: text("build_command").notNull(),
  startCommand: text("start_command").notNull(),
  containerId: text("container_id"),
  containerName: text("container_name"),
  logPath: text("log_path"),
  envVarsSnapshot: text("env_vars_snapshot").notNull().default("{}"),
  configSnapshot: text("config_snapshot").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(""),
  finishedAt: text("finished_at"),
});

export const envVars = sqliteTable("env_vars", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  key: text("key").notNull(),
  value: text("value").notNull(),
  isBuildTime: integer("is_build_time", { mode: "boolean" }).notNull().default(false),
});

export const aliases = sqliteTable("aliases", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  subdomain: text("subdomain").notNull().unique(),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id),
  previousDeploymentId: text("previous_deployment_id"),
  type: text("type").notNull().default("production"),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  type: text("type").notNull(), // deploy, rollback, env_set, env_delete, domain_add, domain_remove
  message: text("message").notNull(),
  meta: text("meta").notNull().default("{}"), // JSON: deploymentId, key, hostname, etc.
  createdAt: text("created_at").notNull().default(""),
});

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  hostname: text("hostname").notNull().unique(),
  sslStatus: text("ssl_status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(""),
});

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  type: text("type").notNull(), // "postgres" | "redis"
  tier: text("tier").notNull(), // "shared" | "isolated" | "external"
  provider: text("provider"), // null | "neon" | "supabase" | "planetscale" | "upstash" | "turso"
  version: text("version"),
  containerName: text("container_name"),
  containerStatus: text("container_status").notNull().default("stopped"),
  dbName: text("db_name"), // database name within shared instance
  envKey: text("env_key"), // "DATABASE_URL" | "REDIS_URL"
  volumePath: text("volume_path"), // Docker volume name
  port: integer("port"),
  config: text("config").notNull().default("{}"), // JSON
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

export const metrics = sqliteTable("metrics", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  containerName: text("container_name").notNull(),
  cpu: real("cpu").notNull(), // percentage
  memoryMb: real("memory_mb").notNull(),
  networkRxKb: real("network_rx_kb").notNull(),
  networkTxKb: real("network_tx_kb").notNull(),
  timestamp: text("timestamp").notNull(),
});

export const serviceBackups = sqliteTable("service_backups", {
  id: text("id").primaryKey(),
  serviceId: text("service_id").notNull().references(() => services.id),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes"),
  type: text("type").notNull().default("manual"), // "manual" | "scheduled" | "pre-delete"
  createdAt: text("created_at").notNull().default(""),
});
