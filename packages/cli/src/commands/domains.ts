import { requireCredentials, api } from "../lib/credentials";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export default async function domains(args: string[]) {
  const creds = requireCredentials();
  const subcommand = args[0]; // add, remove, list

  const configPath = join(process.cwd(), "voss.json");
  let projectName: string;
  if (existsSync(configPath)) {
    projectName = JSON.parse(readFileSync(configPath, "utf-8")).name;
  } else {
    projectName = process.cwd().split("/").pop() ?? "app";
  }

  if (!subcommand || subcommand === "list") {
    const resp = await api(creds, `/api/projects/${projectName}/domains`);
    if (!resp.ok) {
      const err = await resp.json() as any;
      console.error(`  ✕ ${err.message}`);
      process.exit(1);
    }

    const { data: domainList } = await resp.json() as any;
    if (!domainList.length) {
      console.log("  No domains configured. Add one:");
      console.log("    voss domains add example.com");
      return;
    }

    for (const d of domainList) {
      const ssl = d.sslStatus === "active" ? "● SSL" : "○ pending";
      console.log(`  ${d.hostname}  ${ssl}`);
    }
    return;
  }

  if (subcommand === "add") {
    const hostname = args[1];
    if (!hostname) {
      console.error("  Usage: voss domains add example.com");
      process.exit(1);
    }

    const resp = await api(creds, `/api/projects/${projectName}/domains`, {
      method: "POST",
      body: JSON.stringify({ hostname }),
    });

    const result = await resp.json() as any;
    if (!resp.ok) {
      console.error(`  ✕ ${result.message}`);
      process.exit(1);
    }

    console.log(`  ✓ Domain added: ${hostname}`);
    console.log();
    console.log(`  ${result.data.dnsInstruction}`);
    console.log();
    console.log("  After DNS propagates, SSL will be provisioned automatically.");
    return;
  }

  if (subcommand === "remove" || subcommand === "rm") {
    const hostname = args[1];
    if (!hostname) {
      console.error("  Usage: voss domains remove example.com");
      process.exit(1);
    }

    const resp = await api(creds, `/api/projects/${projectName}/domains/${hostname}`, {
      method: "DELETE",
    });

    if (!resp.ok) {
      const err = await resp.json() as any;
      console.error(`  ✕ ${err.message}`);
      process.exit(1);
    }

    console.log(`  ✓ Domain removed: ${hostname}`);
    return;
  }

  console.error(`  Unknown subcommand: ${subcommand}`);
  console.error("  Usage: voss domains [add|remove|list]");
  process.exit(1);
}
