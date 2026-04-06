import { saveCredentials, api } from "../lib/credentials";
import { bold, cyan, dim, green, red, icon, Spinner } from "../ui/style";

export default async function login(args: string[]) {
  const [serverIp, apiKey] = args;

  if (!serverIp || !apiKey) {
    console.error(`  Usage: voss login ${dim("<server-ip>")} ${dim("<api-key>")}`);
    process.exit(1);
  }

  let serverUrl: string;
  if (serverIp.startsWith("http")) {
    serverUrl = serverIp;
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(serverIp)) {
    serverUrl = `http://${serverIp}:3456`;
  } else {
    serverUrl = `https://${serverIp}`;
  }

  const spinner = new Spinner(`Connecting to ${cyan(serverUrl)}`);
  spinner.start();

  try {
    const healthResp = await api({ serverUrl, apiKey }, "/api/health");
    if (!healthResp.ok) {
      spinner.stop(`  ${icon.error} Server returned ${healthResp.status}`);
      process.exit(1);
    }

    const authResp = await api({ serverUrl, apiKey }, "/api/projects");
    if (!authResp.ok) {
      spinner.stop(`  ${icon.error} ${red("Invalid API key")}`);
      process.exit(1);
    }

    const data = await healthResp.json() as { version: string; uptime: number };
    await saveCredentials({ serverUrl, apiKey });

    spinner.stop(`  ${icon.success} Connected to ${bold("voss-server")} ${dim(`v${data.version}`)}`);
    console.log(`    ${dim("Credentials saved to")} ~/.voss/credentials.json`);
    console.log();
  } catch (err) {
    spinner.stop(`  ${icon.error} ${red("Could not connect to")} ${serverUrl}`);
    console.error(`    ${dim((err as Error).message)}`);
    console.error(`    ${dim("Make sure voss-server is running on your VPS")}`);
    process.exit(1);
  }
}
