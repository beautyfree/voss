import { requireCredentials, api } from "../lib/credentials";

export default async function whoami(_args: string[]) {
  const creds = requireCredentials();

  const resp = await api(creds, "/api/health");

  if (!resp.ok) {
    console.error("  ✕ Could not connect to server");
    process.exit(1);
  }

  const data = await resp.json() as { version: string; uptime: number };
  const url = new URL(creds.serverUrl);

  console.log(`  Server:  ${url.hostname}`);
  console.log(`  Version: v${data.version}`);
  console.log(`  Uptime:  ${formatUptime(data.uptime)}`);
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
