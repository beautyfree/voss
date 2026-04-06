#!/usr/bin/env bun

const args = process.argv.slice(2);
const command = args[0];

const COMMANDS: Record<string, () => Promise<void>> = {
  login: () => import("./commands/login").then((m) => m.default(args.slice(1))),
  deploy: () => import("./commands/deploy").then((m) => m.default(args.slice(1))),
  status: () => import("./commands/status").then((m) => m.default(args.slice(1))),
  logs: () => import("./commands/logs").then((m) => m.default(args.slice(1))),
  env: () => import("./commands/env").then((m) => m.default(args.slice(1))),
  rollback: () => import("./commands/rollback").then((m) => m.default(args.slice(1))),
  whoami: () => import("./commands/whoami").then((m) => m.default(args.slice(1))),
  projects: () => import("./commands/projects").then((m) => m.default(args.slice(1))),
  init: () => import("./commands/init").then((m) => m.default(args.slice(1))),
  domains: () => import("./commands/domains").then((m) => m.default(args.slice(1))),
  link: () => import("./commands/link").then((m) => m.default(args.slice(1))),
};

if (!command || command === "--help" || command === "-h") {
  console.log(`
  voss — deploy to your own VPS

  Usage:
    voss login <server-ip> <api-key>   Connect to your VPS
    voss init                          Create voss.json for this project
    voss deploy                        Deploy current project
    voss status                        Show current deployment status
    voss logs                          Tail deployment logs
    voss env set <KEY>=<VALUE>         Set environment variable
    voss env get                       List environment variables
    voss rollback                      Rollback to previous deployment
    voss whoami                        Show connected server info
    voss projects                      List all projects on server
    voss domains add <hostname>        Add custom domain
    voss domains remove <hostname>     Remove custom domain
    voss domains                       List domains
    voss link [repo-url]               Link GitHub repo for auto-deploy

  Options:
    --help, -h                         Show this help
    --version, -v                      Show version
`);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log("voss 0.1.0");
  process.exit(0);
}

const handler = COMMANDS[command];
if (!handler) {
  console.error(`Unknown command: ${command}`);
  console.error("Run 'voss --help' for usage");
  process.exit(1);
}

await handler();
