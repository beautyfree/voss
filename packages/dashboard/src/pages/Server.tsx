import { useEffect, useState } from "react";
import { api } from "../api/client";

interface ContainerStats {
  name: string;
  cpu: string;
  memory: string;
  memPercent: string;
  netIO: string;
}

interface Stats {
  containers: ContainerStats[];
  system: {
    disk: { size: string; used: string; avail: string; percent: string };
    uptime: number;
    memoryMb: number;
  };
}

interface DbStatus {
  shared: {
    postgres: { running: boolean; exists: boolean };
    redis: { running: boolean; exists: boolean };
  };
  totalServices: number;
}

export function Server() {
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  useEffect(() => {
    Promise.all([
      api("/api/health").then(setHealth),
      api<Stats>("/api/stats").then(setStats),
      api<DbStatus>("/api/db/status").then(setDbStatus).catch(() => {}),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Server</h1></div>
        <div className="empty">
          <div className="empty-title">Could not connect to server</div>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Server</h1></div>
        <div className="skeleton" style={{ width: 300, height: 18 }} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Server</h1>
        <p className="page-subtitle">voss-server status</p>
      </div>
      <div className="kv">
        <span className="kv-key">Status</span>
        <span className="kv-val">
          <span className="dot dot-live" /> online
        </span>
        <span className="kv-key">Version</span>
        <span className="kv-val mono">{health?.version ?? "unknown"}</span>
        <span className="kv-key">Uptime</span>
        <span className="kv-val mono">{health ? formatUptime(health.uptime) : "—"}</span>
        {stats?.system.memoryMb && (
          <>
            <span className="kv-key">Server RAM</span>
            <span className="kv-val mono">{stats.system.memoryMb}MB (voss process)</span>
          </>
        )}
        {stats?.system.disk.percent && (
          <>
            <span className="kv-key">Disk</span>
            <span className="kv-val mono">{stats.system.disk.used} / {stats.system.disk.size} ({stats.system.disk.percent})</span>
          </>
        )}
      </div>

      {dbStatus && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "32px 0 16px" }}>Database Infrastructure</h2>
          <div className="kv">
            <span className="kv-key">Shared Postgres</span>
            <span className="kv-val">
              {dbStatus.shared.postgres.running
                ? <><span className="dot dot-live" /> running</>
                : dbStatus.shared.postgres.exists
                  ? <><span className="dot dot-pending" /> stopped</>
                  : <span style={{ color: "var(--muted)" }}>not initialized</span>
              }
            </span>
            <span className="kv-key">Shared Redis</span>
            <span className="kv-val">
              {dbStatus.shared.redis.running
                ? <><span className="dot dot-live" /> running</>
                : dbStatus.shared.redis.exists
                  ? <><span className="dot dot-pending" /> stopped</>
                  : <span style={{ color: "var(--muted)" }}>not initialized</span>
              }
            </span>
            <span className="kv-key">Total Services</span>
            <span className="kv-val mono">{dbStatus.totalServices}</span>
          </div>
          {!dbStatus.shared.postgres.exists && !dbStatus.shared.redis.exists && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 12 }}
              disabled={initializing}
              onClick={async () => {
                setInitializing(true);
                try {
                  await api("/api/db/init", { method: "POST" });
                  const updated = await api<DbStatus>("/api/db/status");
                  setDbStatus(updated);
                } catch {}
                setInitializing(false);
              }}
            >
              {initializing ? "Initializing..." : "Initialize shared databases"}
            </button>
          )}
        </>
      )}

      {stats && stats.containers.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "32px 0 16px" }}>Running Containers</h2>
          <div style={{ fontSize: 13 }}>
            <div className="row" style={{ fontWeight: 600, color: "var(--muted)" }}>
              <span className="row-name">Container</span>
              <span className="row-meta" style={{ width: 80 }}>CPU</span>
              <span className="row-meta" style={{ width: 160 }}>Memory</span>
              <span className="row-meta" style={{ width: 120 }}>Network</span>
            </div>
            {stats.containers.map((c) => (
              <div key={c.name} className="row">
                <span className="row-name mono">{c.name}</span>
                <span className="row-meta" style={{ width: 80 }}>{c.cpu}</span>
                <span className="row-meta" style={{ width: 160 }}>{c.memory}</span>
                <span className="row-meta" style={{ width: 120 }}>{c.netIO}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
