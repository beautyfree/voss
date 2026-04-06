import { saveCredentials, api } from "../lib/credentials";

export default async function login(args: string[]) {
  const [serverIp, apiKey] = args;

  if (!serverIp || !apiKey) {
    console.error("Usage: voss login <server-ip> <api-key>");
    process.exit(1);
  }

  // Use HTTP for bare IPs (no SSL cert), HTTPS for domains
  let serverUrl: string;
  if (serverIp.startsWith("http")) {
    serverUrl = serverIp;
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(serverIp)) {
    serverUrl = `http://${serverIp}:3456`;
  } else {
    serverUrl = `https://${serverIp}`;
  }

  console.log(`  Connecting to ${serverUrl}...`);

  try {
    // First check server is reachable (public endpoint)
    const healthResp = await api({ serverUrl, apiKey }, "/api/health");
    if (!healthResp.ok) {
      console.error(`  ✕ Server returned ${healthResp.status}`);
      process.exit(1);
    }

    // Then verify API key works (authenticated endpoint)
    const authResp = await api({ serverUrl, apiKey }, "/api/projects");
    if (!authResp.ok) {
      console.error("  ✕ Invalid API key");
      process.exit(1);
    }

    const data = await healthResp.json() as { version: string; uptime: number };

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
