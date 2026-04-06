import { getDb, schema } from "../db";
import { eq, desc } from "drizzle-orm";
import { VOSS_LOG_DIR, LOG_KEEP_COUNT, CONTAINER_KEEP_COUNT } from "@voss/shared";
import { $ } from "bun";
import { existsSync } from "fs";
import { readdir, unlink, rmdir } from "fs/promises";
import { join } from "path";
import { stopContainer } from "./runner";

const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

export function startLogCleanup() {
  // Run after 1 minute, then every 6 hours
  setTimeout(runCleanup, 60_000);
  setInterval(runCleanup, CLEANUP_INTERVAL);
}

async function runCleanup() {
  console.log("[cleanup] Starting periodic cleanup...");

  const db = getDb();
  const projects = db.select().from(schema.projects).all();

  for (const project of projects) {
    // Get all deployments for this project, ordered newest first
    const deploys = db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id))
      .orderBy(desc(schema.deployments.createdAt))
      .all();

    // Clean up old log files (keep last LOG_KEEP_COUNT)
    const logDir = join(VOSS_LOG_DIR, project.name);
    if (deploys.length > LOG_KEEP_COUNT) {
      const oldDeploys = deploys.slice(LOG_KEEP_COUNT);
      for (const d of oldDeploys) {
        if (d.logPath && existsSync(d.logPath)) {
          try {
            await unlink(d.logPath);
          } catch {}
        }
      }
    }

    // Stop old containers (keep last CONTAINER_KEEP_COUNT live ones)
    const liveDeploys = deploys.filter((d) => d.status === "live" || d.status === "health_checking" || d.status === "building");
    if (liveDeploys.length > CONTAINER_KEEP_COUNT) {
      const oldContainers = liveDeploys.slice(CONTAINER_KEEP_COUNT);
      for (const d of oldContainers) {
        if (d.containerName) {
          try {
            await stopContainer(d.containerName);
            db.update(schema.deployments)
              .set({ status: "rolled_back" })
              .where(eq(schema.deployments.id, d.id))
              .run();
          } catch {}
        }
      }
    }
  }

  // Prune dangling Docker images
  try {
    await $`docker image prune -f`.quiet();
  } catch {}

  console.log("[cleanup] Done.");
}
