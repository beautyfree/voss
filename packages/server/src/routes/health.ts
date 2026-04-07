import { Elysia } from "elysia";
import { $ } from "bun";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db";

export const healthRoutes = new Elysia({ prefix: "/api" })
  .get("/health", () => ({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
  }))
  .get("/stats", async () => {
    try {
      // Docker container stats for all voss- containers
      const ids = await $`docker ps --filter "label=voss.project" -q`.text();
      let containers: any[] = [];
      if (ids.trim()) {
        const output = await $`docker stats --no-stream --format ${"{{json .}}"} ${ids.trim().split("\n")}`.text();
        containers = output.trim().split("\n").filter(Boolean).map((line) => {
          try {
            const s = JSON.parse(line);
            return { name: s.Name, cpu: s.CPUPerc, memory: s.MemUsage, memPercent: s.MemPerc, netIO: s.NetIO };
          } catch { return null; }
        }).filter(Boolean);
      }

      // Disk usage
      let disk = { size: "", used: "", avail: "", percent: "" };
      try {
        const d = await $`df -h / | tail -1`.text();
        const parts = d.trim().split(/\s+/);
        disk = { size: parts[1], used: parts[2], avail: parts[3], percent: parts[4] };
      } catch (e) { console.error("[stats] Disk check failed:", (e as Error).message); }

      return {
        data: {
          containers,
          system: {
            disk,
            uptime: Math.floor(process.uptime()),
            memoryMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
          },
        },
      };
    } catch {
      return { data: { containers: [], system: {} } };
    }
  })
  .get("/projects/:name/metrics", ({ params, query }) => {
    const db = getDb();
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.name, params.name)).get();
    if (!project) {
      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Project not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Period: 1h, 6h, 24h (default 1h)
    const period = (query as any)?.period ?? "1h";
    const hours = period === "24h" ? 24 : period === "6h" ? 6 : 1;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const allMetrics = db.select().from(schema.metrics)
      .where(eq(schema.metrics.projectId, project.id))
      .orderBy(desc(schema.metrics.timestamp))
      .all()
      .filter(m => m.timestamp >= cutoff);

    // Downsample to ~60 points for the chart
    const maxPoints = 60;
    const step = Math.max(1, Math.floor(allMetrics.length / maxPoints));
    const sampled = allMetrics.filter((_, i) => i % step === 0).reverse();

    return { data: sampled };
  });
