import { Elysia } from "elysia";
import { $ } from "bun";

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
  });
