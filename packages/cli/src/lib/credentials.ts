import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
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
    const data = JSON.parse(Bun.file(path).textSync());
    if (!data.serverUrl || !data.apiKey) return null;
    return data as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  const dir = join(homedir(), CLI_CONFIG_DIR);
  await Bun.write(join(dir, "dummy"), ""); // ensure dir exists
  await Bun.file(join(dir, "dummy")).delete();

  const { mkdir } = await import("fs/promises");
  await mkdir(dir, { recursive: true });
  await Bun.write(getCredentialsPath(), JSON.stringify(creds, null, 2));
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
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.apiKey}`,
      ...options.headers,
    },
  });
}
