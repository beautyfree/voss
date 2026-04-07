// Input validation for user-supplied values

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
