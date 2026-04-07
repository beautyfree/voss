// Input validation for user-supplied values

import { PROVIDER_URL_PATTERNS } from "./constants";
import type { ServiceProvider } from "./types";

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const PROJECT_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const RESERVED_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CERT_PATH",
]);

export function validateHostname(hostname: string): string | null {
  if (!hostname || hostname.length > 253) return "Hostname too long (max 253 chars)";
  if (!HOSTNAME_RE.test(hostname)) return "Invalid hostname: only lowercase letters, numbers, dots, and hyphens allowed";
  if (hostname.includes("..")) return "Invalid hostname: consecutive dots";
  return null;
}

export function validateProjectName(name: string): string | null {
  if (!name || name.length > 63) return "Project name too long (max 63 chars)";
  if (!PROJECT_NAME_RE.test(name)) return "Invalid project name: only lowercase letters, numbers, and hyphens allowed";
  return null;
}

export function validateEnvKey(key: string): string | null {
  if (!key || key.length > 256) return "Env key too long (max 256 chars)";
  if (!ENV_KEY_RE.test(key)) return "Invalid env key: must start with letter or underscore, only alphanumeric and underscores";
  if (RESERVED_ENV_KEYS.has(key)) return `Reserved env key: ${key}`;
  return null;
}

/**
 * Validate a connection URL for an external database provider.
 * Returns null if valid, error message if invalid.
 */
export function validateConnectionUrl(provider: ServiceProvider, url: string): string | null {
  if (!url || url.length > 2048) return "Connection URL too long (max 2048 chars)";

  const pattern = PROVIDER_URL_PATTERNS[provider];
  if (!pattern) return `Unknown provider: ${provider}`;

  if (!pattern.test(url)) {
    return `Invalid ${provider} connection URL. Expected format: ${getProviderUrlExample(provider)}`;
  }

  // Basic URL parse check
  try {
    // turso uses libsql:// which isn't parseable by URL constructor
    if (provider !== "turso") {
      new URL(url);
    }
  } catch {
    return "Connection URL is not a valid URL";
  }

  return null;
}

function getProviderUrlExample(provider: ServiceProvider): string {
  switch (provider) {
    case "neon": return "postgresql://user:pass@ep-xxx.neon.tech/dbname";
    case "supabase": return "postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres";
    case "planetscale": return "mysql://user:pass@xxx.psdb.cloud/dbname";
    case "upstash": return "redis://default:pass@xxx.upstash.io:6379";
    case "turso": return "libsql://dbname-user.turso.io";
  }
}
