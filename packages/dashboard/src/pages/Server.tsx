import { useEffect, useState } from "react";
import { client } from "../api/client";

export function Server() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.api.health.get()
      .then((res) => { if (res.data) setHealth(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      </div>
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
