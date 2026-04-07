import { DETECTION_ORDER, RUNNERS } from "./constants";
import type { FrameworkId, ServiceConfig, ServiceType, VossConfig } from "./types";

/**
 * Parse and validate voss.json config.
 * Returns validated config or throws with structured error.
 */
export function parseConfig(raw: unknown): VossConfig {
  if (!raw || typeof raw !== "object") {
    throw new ConfigError("INVALID_CONFIG", "voss.json must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== "string") {
    throw new ConfigError("INVALID_CONFIG", "voss.json requires a 'name' field (string)");
  }

  const config: VossConfig = {
    name: obj.name,
  };

  if (obj.framework !== undefined) {
    if (typeof obj.framework !== "string" || !(obj.framework in RUNNERS)) {
      throw new ConfigError(
        "INVALID_CONFIG",
        `Unknown framework '${obj.framework}'. Valid: ${Object.keys(RUNNERS).join(", ")}`
      );
    }
    config.framework = obj.framework as FrameworkId;
  }

  if (obj.rootDirectory !== undefined) {
    if (typeof obj.rootDirectory !== "string") {
      throw new ConfigError("INVALID_CONFIG", "'rootDirectory' must be a string");
    }
    config.rootDirectory = obj.rootDirectory;
  }

  if (obj.buildCommand !== undefined) {
    if (typeof obj.buildCommand !== "string") {
      throw new ConfigError("INVALID_CONFIG", "'buildCommand' must be a string");
    }
    config.buildCommand = obj.buildCommand;
  }

  if (obj.startCommand !== undefined) {
    if (typeof obj.startCommand !== "string") {
      throw new ConfigError("INVALID_CONFIG", "'startCommand' must be a string");
    }
    config.startCommand = obj.startCommand;
  }

  if (obj.outputDirectory !== undefined) {
    if (typeof obj.outputDirectory !== "string") {
      throw new ConfigError("INVALID_CONFIG", "'outputDirectory' must be a string");
    }
    config.outputDirectory = obj.outputDirectory;
  }

  if (obj.env !== undefined) {
    if (typeof obj.env !== "object" || obj.env === null) {
      throw new ConfigError("INVALID_CONFIG", "'env' must be an object");
    }
    config.env = obj.env as Record<string, string>;
  }

  if (obj.domains !== undefined) {
    if (!Array.isArray(obj.domains) || !obj.domains.every((d) => typeof d === "string")) {
      throw new ConfigError("INVALID_CONFIG", "'domains' must be an array of strings");
    }
    config.domains = obj.domains;
  }

  if (obj.resources !== undefined) {
    if (typeof obj.resources !== "object" || obj.resources === null) {
      throw new ConfigError("INVALID_CONFIG", "'resources' must be an object");
    }
    const res = obj.resources as Record<string, unknown>;
    config.resources = {};
    if (res.memory !== undefined) {
      if (typeof res.memory !== "string") {
        throw new ConfigError("INVALID_CONFIG", "'resources.memory' must be a string (e.g. '512MB')");
      }
      config.resources.memory = res.memory;
    }
    if (res.cpu !== undefined) {
      if (typeof res.cpu !== "number" || res.cpu <= 0) {
        throw new ConfigError("INVALID_CONFIG", "'resources.cpu' must be a positive number");
      }
      config.resources.cpu = res.cpu;
    }
  }

  if (obj.healthCheck !== undefined) {
    if (typeof obj.healthCheck !== "object" || obj.healthCheck === null) {
      throw new ConfigError("INVALID_CONFIG", "'healthCheck' must be an object");
    }
    const hc = obj.healthCheck as Record<string, unknown>;
    config.healthCheck = {};
    if (hc.path !== undefined) {
      if (typeof hc.path !== "string") {
        throw new ConfigError("INVALID_CONFIG", "'healthCheck.path' must be a string");
      }
      config.healthCheck.path = hc.path;
    }
    if (hc.timeout !== undefined) {
      if (typeof hc.timeout !== "number" || hc.timeout <= 0) {
        throw new ConfigError("INVALID_CONFIG", "'healthCheck.timeout' must be a positive number (seconds)");
      }
      config.healthCheck.timeout = hc.timeout;
    }
  }

  if (obj.services !== undefined) {
    if (typeof obj.services !== "object" || obj.services === null) {
      throw new ConfigError("INVALID_CONFIG", "'services' must be an object");
    }
    const svc = obj.services as Record<string, unknown>;
    config.services = {};
    const validTypes: ServiceType[] = ["postgres", "redis"];
    for (const [key, val] of Object.entries(svc)) {
      if (!validTypes.includes(key as ServiceType)) {
        throw new ConfigError("INVALID_CONFIG", `Unknown service type '${key}'. Valid: ${validTypes.join(", ")}`);
      }
      if (val === true) {
        (config.services as Record<string, ServiceConfig | boolean>)[key] = true;
      } else if (typeof val === "object" && val !== null) {
        const svcCfg = val as Record<string, unknown>;
        const parsed: ServiceConfig = {};
        if (svcCfg.version !== undefined) {
          if (typeof svcCfg.version !== "string") throw new ConfigError("INVALID_CONFIG", `'services.${key}.version' must be a string`);
          parsed.version = svcCfg.version;
        }
        if (svcCfg.tier !== undefined) {
          if (svcCfg.tier !== "shared" && svcCfg.tier !== "isolated") {
            throw new ConfigError("INVALID_CONFIG", `'services.${key}.tier' must be 'shared' or 'isolated'`);
          }
          parsed.tier = svcCfg.tier;
        }
        if (svcCfg.memory !== undefined) {
          if (typeof svcCfg.memory !== "string") throw new ConfigError("INVALID_CONFIG", `'services.${key}.memory' must be a string`);
          parsed.memory = svcCfg.memory;
        }
        if (svcCfg.maxConnections !== undefined) {
          if (typeof svcCfg.maxConnections !== "number" || svcCfg.maxConnections <= 0) {
            throw new ConfigError("INVALID_CONFIG", `'services.${key}.maxConnections' must be a positive number`);
          }
          parsed.maxConnections = svcCfg.maxConnections;
        }
        (config.services as Record<string, ServiceConfig | boolean>)[key] = parsed;
      } else {
        throw new ConfigError("INVALID_CONFIG", `'services.${key}' must be true or a config object`);
      }
    }
  }

  return config;
}

export class ConfigError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Detect framework from file list (lightweight, runs on CLI side).
 * Returns the first matching framework based on detection priority.
 */
export function detectFramework(files: string[]): FrameworkId {
  const fileSet = new Set(files.map((f) => f.split("/").pop() ?? f));

  for (const fw of DETECTION_ORDER) {
    const runner = RUNNERS[fw];
    if (runner.detectFiles.some((df) => fileSet.has(df))) {
      return fw;
    }
  }

  return "unknown";
}
