import type { FrameworkId } from "./types";

// ── Runner image catalog ──
// Maps framework to pre-built Docker image + default build/start commands
// Inspired by devpush's runner catalog approach

export interface RunnerConfig {
  image: string;
  buildCommand: string;
  startCommand: string;
  port: number;
  detectFiles: string[]; // files that indicate this framework
}

export const RUNNERS: Record<FrameworkId, RunnerConfig> = {
  nextjs: {
    image: "node:20-slim",
    buildCommand: "npm install && npm run build",
    startCommand: "npm start",
    port: 3000,
    detectFiles: ["next.config.js", "next.config.ts", "next.config.mjs"],
  },
  vite: {
    image: "node:20-slim",
    buildCommand: "npm install && npm run build",
    startCommand: "npx serve dist -l 3000",
    port: 3000,
    detectFiles: ["vite.config.ts", "vite.config.js", "vite.config.mts"],
  },
  astro: {
    image: "node:20-slim",
    buildCommand: "npm install && npm run build",
    startCommand: "node ./dist/server/entry.mjs",
    port: 4321,
    detectFiles: ["astro.config.ts", "astro.config.mjs"],
  },
  remix: {
    image: "node:20-slim",
    buildCommand: "npm install && npm run build",
    startCommand: "npm start",
    port: 3000,
    detectFiles: ["remix.config.js", "remix.config.ts"],
  },
  nuxt: {
    image: "node:20-slim",
    buildCommand: "npm install && npm run build",
    startCommand: "node .output/server/index.mjs",
    port: 3000,
    detectFiles: ["nuxt.config.ts", "nuxt.config.js"],
  },
  svelte: {
    image: "node:20-slim",
    buildCommand: "npm install && npm run build",
    startCommand: "node build",
    port: 3000,
    detectFiles: ["svelte.config.js", "svelte.config.ts"],
  },
  bun: {
    image: "oven/bun:1.3",
    buildCommand: "bun install",
    startCommand: "bun run start",
    port: 3000,
    detectFiles: ["bunfig.toml"],
  },
  node: {
    image: "node:20-slim",
    buildCommand: "npm install",
    startCommand: "node index.js",
    port: 3000,
    detectFiles: ["package.json"], // lowest priority, fallback
  },
  static: {
    image: "node:20-slim",
    buildCommand: "npm install && npm run build",
    startCommand: "npx serve dist -l 3000",
    port: 3000,
    detectFiles: ["index.html"],
  },
  dockerfile: {
    image: "", // built from Dockerfile
    buildCommand: "",
    startCommand: "",
    port: 3000,
    detectFiles: ["Dockerfile"],
  },
  unknown: {
    image: "node:20-slim",
    buildCommand: "npm install",
    startCommand: "npm start",
    port: 3000,
    detectFiles: [],
  },
};

// Detection priority: first match wins
export const DETECTION_ORDER: FrameworkId[] = [
  "dockerfile",
  "nextjs",
  "astro",
  "remix",
  "nuxt",
  "svelte",
  "vite",
  "bun",
  "static",
  "node",
];

// ── Limits ──

export const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 500MB
export const MAX_CONCURRENT_BUILDS = 1;
export const HEALTH_CHECK_DEFAULT_TIMEOUT = 300_000; // 5 min (build + start on 1 CPU takes time)
export const HEALTH_CHECK_DEFAULT_PATH = "/";
export const CONTAINER_KEEP_COUNT = 2; // keep last N deployments alive for rollback
export const LOG_KEEP_COUNT = 10; // keep last N deploy log files
export const IMAGE_PRUNE_KEEP = 3; // keep last N images per project

// ── Docker ──

export const DOCKER_NETWORK_RUNNER = "voss_runner";
export const DOCKER_NETWORK_INTERNAL = "voss_internal";

// ── Paths ──

export const VOSS_DATA_DIR = "/var/voss";
export const VOSS_LOG_DIR = "/var/voss/logs";
export const VOSS_CONFIG_PATH = "/etc/voss/config.json";
export const VOSS_UPLOADS_DIR = "/var/voss/uploads";
export const VOSS_TRAEFIK_DYNAMIC_DIR = "/etc/traefik/dynamic";
export const VOSS_DB_PATH = "/var/voss/data/voss.db";
export const VOSS_BACKUP_DIR = "/var/voss/backups";

// ── CLI ──

export const CLI_CONFIG_DIR = ".voss";
export const CLI_CREDENTIALS_FILE = "credentials.json";
