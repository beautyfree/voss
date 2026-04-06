import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { CLI_CONFIG_DIR, CLI_CREDENTIALS_FILE } from "@voss/shared";

export interface Credentials {
  serverUrl: string;
  apiKey: string;
}

function getCredentialsPath(): string {
  return join(homedir(), CLI_CONFIG_DIR, CLI_CREDENTIALS_FILE);
}

export function loadCredentials(): Credentials | null {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    if (!data.serverUrl || !data.apiKey) return null;
    return data as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  const dir = join(homedir(), CLI_CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(getCredentialsPath(), JSON.stringify(creds, null, 2));
}

export function requireCredentials(): Credentials {
  const creds = loadCredentials();
  if (!creds) {
    console.error("Not logged in. Run: voss login <server-ip> <api-key>");
    process.exit(1);
  }
  return creds;
}

/**
 * Make an authenticated API call to the voss server.
 */
export async function api(
  creds: Credentials,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${creds.serverUrl}${path}`;
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${creds.apiKey}`);
  return fetch(url, { ...options, headers });
}
