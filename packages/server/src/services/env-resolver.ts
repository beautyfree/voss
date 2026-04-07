import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import { DB_ENV_KEYS } from "@voss/shared";

const REF_PATTERN = /\$\{\{([^}]+)\}\}/g;

/**
 * Resolve reference variables in env vars.
 *
 * Supported patterns:
 *   ${{postgres.url}}  → DATABASE_URL value
 *   ${{redis.url}}     → REDIS_URL value
 *   ${{project.name}}  → project name
 *   ${{project.domain}} → project domain
 *
 * Stores template as-is in DB, resolves at deploy time.
 */
export function resolveEnvVars(
  projectId: string,
  envVars: Record<string, string>,
): Record<string, string> {
  const db = getDb();
  const resolved: Record<string, string> = {};

  // Build context for resolution
  const project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).get();

  const allEnvVars = db.select().from(schema.envVars)
    .where(eq(schema.envVars.projectId, projectId)).all();

  const envMap: Record<string, string> = {};
  for (const v of allEnvVars) {
    envMap[v.key] = v.value;
  }

  const domain = process.env.VOSS_DOMAIN ?? "localhost";

  const context: Record<string, string> = {
    "postgres.url": envMap[DB_ENV_KEYS.postgres] ?? "",
    "redis.url": envMap[DB_ENV_KEYS.redis] ?? "",
    "project.name": project?.name ?? "",
    "project.domain": project ? `${project.name}.${domain}` : "",
  };

  for (const [key, value] of Object.entries(envVars)) {
    resolved[key] = value.replace(REF_PATTERN, (_match, ref: string) => {
      const trimmed = ref.trim();
      if (trimmed in context) {
        return context[trimmed];
      }
      // Try to resolve as env var name: ${{ENV_KEY}}
      if (trimmed in envMap) {
        return envMap[trimmed];
      }
      // Unresolved — leave as-is
      console.warn(`[env-resolver] Unresolved reference: $\{{${trimmed}}}`);
      return _match;
    });
  }

  return resolved;
}

/**
 * Check if a value contains reference variables.
 */
export function hasReferences(value: string): boolean {
  return REF_PATTERN.test(value);
}
