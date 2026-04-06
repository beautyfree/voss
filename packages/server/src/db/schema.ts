import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  framework: text("framework").notNull().default("unknown"),
  serverId: text("server_id").notNull().default("local"),
  domain: text("domain"),
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

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  hostname: text("hostname").notNull().unique(),
  sslStatus: text("ssl_status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(""),
});
