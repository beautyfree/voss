import { saveCredentials, api } from "../lib/credentials";

export default async function login(args: string[]) {
  const [serverIp, apiKey] = args;

  if (!serverIp || !apiKey) {
    console.error("Usage: voss login <server-ip> <api-key>");
    process.exit(1);
  }

  const serverUrl = serverIp.startsWith("http")
    ? serverIp
    : `https://${serverIp}:3456`;

  console.log(`  Connecting to ${serverUrl}...`);

  try {
    const resp = await api({ serverUrl, apiKey }, "/api/health");

    if (!resp.ok) {
      console.error(`  ✕ Server returned ${resp.status}`);
      if (resp.status === 401) {
        console.error("    Invalid API key");
      }
      process.exit(1);
    }

    const data = await resp.json() as { version: string; uptime: number };

    await saveCredentials({ serverUrl, apiKey });

    console.log(`  ✓ Connected to voss-server v${data.version}`);
    console.log(`    Server uptime: ${Math.floor(data.uptime)}s`);
    console.log(`    Credentials saved to ~/.voss/credentials.json`);
  } catch (err) {
    console.error(`  ✕ Could not connect to ${serverUrl}`);
    console.error(`    ${(err as Error).message}`);
    console.error("    Make sure voss-server is running on your VPS");
    process.exit(1);
  }
}
