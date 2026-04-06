# voss

Deploy to your own VPS. One command.

<p align="center">
  <img src="assets/demo.svg" alt="voss deploy demo" width="640">
</p>

## What is this

voss is a self-hosted deployment platform. Like Vercel, but on your own server.

- **CLI-first.** `voss deploy` and you're done.
- **Zero config.** Auto-detects Next.js, Vite, Astro, Remix, Nuxt, SvelteKit.
- **Auto-detects everything.** Package manager (npm/pnpm/yarn/bun), monorepo structure, framework.
- **SHA dedup.** Only uploads changed files. 361KB instead of 220MB.
- **Instant rollback.** `voss rollback` swaps to the previous deployment in seconds.
- **Auto SSL.** Traefik + Let's Encrypt. `voss domains add example.com` and HTTPS just works.
- **Your server, your rules.** SSH in, see real logs, full control.

## Quick start

### 1. Setup your VPS (Ubuntu/Debian, 2GB+ RAM)

```bash
curl -fsSL https://raw.githubusercontent.com/beautyfree/voss/main/scripts/install.sh | sudo bash
```

This installs Docker, Traefik, Bun, and voss-server. Takes ~2 minutes. Outputs an API key.

### 2. Connect from your laptop

```bash
npm i -g @voss/cli  # or just clone this repo and alias it
voss login <your-server-ip> <api-key>
```

### 3. Deploy

```bash
cd my-next-app
voss deploy
```

That's it.

## Commands

| Command | What it does |
|---------|-------------|
| `voss deploy` | Deploy current project |
| `voss deploy --verbose` | Deploy with detailed output |
| `voss status` | Show current deployment status |
| `voss logs` | Stream deployment logs |
| `voss rollback` | Rollback to previous deployment |
| `voss env set KEY=VALUE` | Set environment variable |
| `voss env list` | List environment variables |
| `voss domains add example.com` | Add custom domain with auto-SSL |
| `voss domains remove example.com` | Remove domain |
| `voss projects` | List all deployed projects |
| `voss whoami` | Show connected server info |
| `voss init` | Create voss.json config |

## voss.json

Optional. voss auto-detects everything, but you can override:

```json
{
  "name": "my-app",
  "framework": "nextjs",
  "rootDirectory": "apps/web",
  "buildCommand": "pnpm run build",
  "startCommand": "pnpm start",
  "healthCheck": {
    "path": "/api/health",
    "timeout": 120
  },
  "resources": {
    "memory": "1024MB",
    "cpu": 1
  }
}
```

## Architecture

```
Your laptop                         Your VPS ($4-5/mo)
+-----------+                       +---------------------------+
|  voss CLI | ---HTTPS/WS-------->  |  Traefik (reverse proxy)  |
|           |    361KB upload       |    auto-SSL, routing      |
+-----------+                       +---------------------------+
                                    |  voss-server (ElysiaJS)   |
                                    |    API, deploy pipeline,  |
                                    |    SQLite, WebSocket      |
                                    +---------------------------+
                                    |  Docker containers        |
                                    |    your-app:3000          |
                                    |    another-app:3000       |
                                    +---------------------------+
```

- **CLI:** Bun + TypeScript. Compiles to single binary.
- **Server:** ElysiaJS + Drizzle + SQLite. Single process.
- **Routing:** Traefik file provider. Auto-SSL via Let's Encrypt.
- **Containers:** Pre-built runner images (node:20-slim). Code mounted at start.
- **Deploy:** Upload changed files, build inside container, health check, swap routing.

## Supported frameworks

| Framework | Detection | Runner |
|-----------|-----------|--------|
| Next.js | next.config.* | node:20-slim |
| Vite | vite.config.* | node:20-slim |
| Astro | astro.config.* | node:20-slim |
| Remix | remix.config.* | node:20-slim |
| Nuxt | nuxt.config.* | node:20-slim |
| SvelteKit | svelte.config.* | node:20-slim |
| Bun | bunfig.toml | oven/bun:1.3 |
| Node.js | package.json | node:20-slim |
| Static | index.html | node:20-slim |

Package managers: npm, pnpm, yarn, bun. Auto-detected from lock files.

Monorepos: turbo, pnpm workspaces. Auto-detected or set `rootDirectory` in voss.json.

## Why not Coolify/Dokku/Dokploy?

They're great. But they manage servers. voss manages projects.

`voss deploy` is closer to `vercel` than to `coolify`. No web UI to click through, no Docker knowledge needed, no YAML to write. Just deploy.

## Development

```bash
git clone https://github.com/beautyfree/voss.git
cd voss
bun install
bun test

# Run CLI locally
bun run packages/cli/src/index.ts --help

# Run server locally
VOSS_API_KEY=test bun run packages/server/src/index.ts
```

## License

MIT
