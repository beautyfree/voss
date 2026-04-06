import { describe, test, expect } from "bun:test";
import { parseConfig, ConfigError, detectFramework } from "../src/config";

describe("parseConfig", () => {
  test("parses valid minimal config", () => {
    const config = parseConfig({ name: "my-app" });
    expect(config.name).toBe("my-app");
    expect(config.framework).toBeUndefined();
  });

  test("parses full config", () => {
    const config = parseConfig({
      name: "my-app",
      framework: "nextjs",
      buildCommand: "npm run build",
      startCommand: "npm start",
      outputDirectory: ".next",
      env: { NODE_ENV: "production" },
      domains: ["example.com"],
      resources: { memory: "1024MB", cpu: 1 },
      healthCheck: { path: "/health", timeout: 120 },
    });

    expect(config.framework).toBe("nextjs");
    expect(config.buildCommand).toBe("npm run build");
    expect(config.resources?.memory).toBe("1024MB");
    expect(config.healthCheck?.timeout).toBe(120);
  });

  test("throws on missing name", () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
  });

  test("throws on invalid framework", () => {
    expect(() => parseConfig({ name: "app", framework: "django" })).toThrow(ConfigError);
  });

  test("throws on non-object input", () => {
    expect(() => parseConfig(null)).toThrow(ConfigError);
    expect(() => parseConfig("string")).toThrow(ConfigError);
  });

  test("throws on invalid resource types", () => {
    expect(() => parseConfig({ name: "app", resources: { memory: 123 } })).toThrow(ConfigError);
    expect(() => parseConfig({ name: "app", resources: { cpu: -1 } })).toThrow(ConfigError);
  });

  test("throws on invalid healthCheck", () => {
    expect(() => parseConfig({ name: "app", healthCheck: { timeout: "fast" } })).toThrow(ConfigError);
  });
});

describe("detectFramework", () => {
  test("detects Next.js", () => {
    expect(detectFramework(["package.json", "next.config.ts", "tsconfig.json"])).toBe("nextjs");
  });

  test("detects Astro", () => {
    expect(detectFramework(["package.json", "astro.config.mjs"])).toBe("astro");
  });

  test("detects Vite", () => {
    expect(detectFramework(["package.json", "vite.config.ts"])).toBe("vite");
  });

  test("detects Remix", () => {
    expect(detectFramework(["package.json", "remix.config.js"])).toBe("remix");
  });

  test("detects Bun", () => {
    expect(detectFramework(["bunfig.toml", "index.ts"])).toBe("bun");
  });

  test("detects static site", () => {
    expect(detectFramework(["index.html", "style.css"])).toBe("static");
  });

  test("falls back to node for package.json only", () => {
    expect(detectFramework(["package.json", "server.js"])).toBe("node");
  });

  test("returns unknown for empty", () => {
    expect(detectFramework([])).toBe("unknown");
  });

  test("prioritizes framework over node fallback", () => {
    // next.config.ts should win over package.json
    expect(detectFramework(["package.json", "next.config.ts"])).toBe("nextjs");
  });

  test("handles nested file paths", () => {
    expect(detectFramework(["src/pages/index.tsx", "next.config.mjs"])).toBe("nextjs");
  });
});
