import { $ } from "bun";
import { getDb, schema } from "../db";
import { eq, and, desc } from "drizzle-orm";

const COLLECT_INTERVAL = 30_000; // 30 seconds
const MAX_METRICS_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Start the background metrics collector.
 * Collects docker stats for all voss containers every 30s.
 */
export function startMetricsCollector() {
  setTimeout(collectMetrics, 10_000); // first run after 10s
  setInterval(collectMetrics, COLLECT_INTERVAL);
}

async function collectMetrics() {
  try {
    const ids = await $`docker ps --filter "label=voss.project" -q`.text();
    if (!ids.trim()) return;

    const output = await $`docker stats --no-stream --format ${"{{json .}}"} ${ids.trim().split("\n")}`.text();
    const lines = output.trim().split("\n").filter(Boolean);

    const db = getDb();
    const now = new Date().toISOString();

    for (const line of lines) {
      try {
        const s = JSON.parse(line);
        const containerName = s.Name as string;

        // Find project for this container
        const deployment = db.select().from(schema.deployments)
          .where(eq(schema.deployments.containerName, containerName))
          .get();
        if (!deployment) continue;

        const cpu = parsePercent(s.CPUPerc);
        const memoryMb = parseMemory(s.MemUsage);
        const [rxKb, txKb] = parseNetIO(s.NetIO);

        db.insert(schema.metrics).values({
          id: crypto.randomUUID(),
          projectId: deployment.projectId,
          containerName,
          cpu,
          memoryMb,
          networkRxKb: rxKb,
          networkTxKb: txKb,
          timestamp: now,
        }).run();
      } catch {
        // Skip unparseable lines
      }
    }

    // Prune old metrics (keep 24h)
    const cutoff = new Date(Date.now() - MAX_METRICS_AGE).toISOString();
    db.delete(schema.metrics)
      .where(eq(schema.metrics.timestamp, cutoff))
      .run();
    // Use raw SQL for < comparison since drizzle doesn't support lt on text easily
    const sqlite = (db as any).$client;
    if (sqlite?.exec) {
      sqlite.exec(`DELETE FROM metrics WHERE timestamp < '${cutoff}'`);
    }
  } catch (e) {
    // Non-fatal — metrics collection is best-effort
  }
}

function parsePercent(s: string): number {
  return parseFloat(s?.replace("%", "") ?? "0") || 0;
}

function parseMemory(s: string): number {
  // "123.4MiB / 1.5GiB" → 123.4
  const match = s?.match(/([\d.]+)\s*(MiB|GiB|KiB)/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (match[2] === "GiB") return val * 1024;
  if (match[2] === "KiB") return val / 1024;
  return val; // MiB
}

function parseNetIO(s: string): [number, number] {
  // "1.23kB / 4.56kB" → [1.23, 4.56]
  const parts = s?.split("/").map(p => p.trim()) ?? [];
  return [parseNetVal(parts[0]), parseNetVal(parts[1])];
}

function parseNetVal(s: string): number {
  if (!s) return 0;
  const match = s.match(/([\d.]+)\s*(kB|MB|GB|B)/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (match[2] === "B") return val / 1024;
  if (match[2] === "MB") return val * 1024;
  if (match[2] === "GB") return val * 1024 * 1024;
  return val; // kB
}
