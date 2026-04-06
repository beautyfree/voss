import { requireCredentials, api } from "../lib/credentials";
import { existsSync } from "fs";
import { join } from "path";

export default async function logs(args: string[]) {
  const creds = requireCredentials();

  const configPath = join(process.cwd(), "voss.json");
  let projectName: string;

  if (existsSync(configPath)) {
    const config = JSON.parse(await Bun.file(configPath).text());
    projectName = config.name;
  } else {
    projectName = process.cwd().split("/").pop() ?? "app";
  }

  // Check for specific deployment ID
  const deployFlag = args.indexOf("--deploy");
  let deploymentId: string | null = null;

  if (deployFlag !== -1 && args[deployFlag + 1]) {
    deploymentId = args[deployFlag + 1];
  }

  // Get deployment to stream
  if (!deploymentId) {
    const resp = await api(creds, `/api/projects/${projectName}/deployments`);
    if (!resp.ok) {
      console.error("  ✕ Could not fetch deployments");
      process.exit(1);
    }

    const { data: deploys } = await resp.json() as any;
    if (!deploys.length) {
      console.log("  No deployments yet. Run: voss deploy");
      return;
    }

    deploymentId = deploys[0].id;
  }

  console.log(`  Streaming logs for ${deploymentId!.slice(0, 8)}...\n`);

  // Connect via WebSocket
  const wsUrl = creds.serverUrl.replace("https://", "wss://").replace("http://", "ws://");

  try {
    const ws = new WebSocket(`${wsUrl}/ws/logs/${deploymentId}`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "log") {
          process.stdout.write(msg.data + "\n");
        } else if (msg.type === "status") {
          console.log(`\n  [status: ${msg.status}]`);
        }
      } catch {
        process.stdout.write(event.data + "\n");
      }
    };

    ws.onerror = () => {
      console.error("  ✕ WebSocket connection failed");
      console.error("    Falling back to deployment info...");
      showDeployInfo(creds, deploymentId!);
    };

    ws.onclose = () => {
      console.log("\n  [stream ended]");
    };

    // Keep alive until user presses Ctrl+C
    process.on("SIGINT", () => {
      ws.close();
      process.exit(0);
    });

    // Keep the process running
    await new Promise(() => {});
  } catch {
    await showDeployInfo(creds, deploymentId!);
  }
}

async function showDeployInfo(creds: any, deploymentId: string) {
  const resp = await api(creds, `/api/deployments/${deploymentId}`);
  if (!resp.ok) {
    console.error("  ✕ Deployment not found");
    process.exit(1);
  }

  const { data: d } = await resp.json() as any;
  console.log(`  Status:  ${d.status}`);
  console.log(`  Image:   ${d.runnerImage}`);
  console.log(`  Build:   ${d.buildCommand}`);
  console.log(`  Start:   ${d.startCommand}`);
  console.log(`  Created: ${d.createdAt}`);
  if (d.logPath) console.log(`  Log:     ${d.logPath}`);
}
