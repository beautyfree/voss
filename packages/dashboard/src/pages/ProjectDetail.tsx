import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusDot";

interface Deployment {
  id: string;
  status: string;
  branch: string | null;
  createdAt: string;
  finishedAt: string | null;
  runnerImage: string;
  buildCommand: string;
}

interface ProjectData {
  id: string;
  name: string;
  framework: string;
  domain: string | null;
  latestDeployment: Deployment | null;
}

interface Domain {
  id: string;
  hostname: string;
  sslStatus: string;
}

interface EnvVar {
  key: string;
  value: string;
  isBuildTime: boolean;
}

interface LogMessage {
  type: "log" | "status";
  data?: string;
  status?: string;
}

export function ProjectDetail() {
  const { name } = useParams<{ name: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [deploys, setDeploys] = useState<Deployment[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  // Env form state
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newIsBuild, setNewIsBuild] = useState(false);
  const [envSaving, setEnvSaving] = useState(false);

  // Domain form state
  const [newDomain, setNewDomain] = useState("");
  const [domainSaving, setDomainSaving] = useState(false);

  // Redeploy state
  const [redeploying, setRedeploying] = useState(false);

  // Log streaming state
  const [logDeployId, setLogDeployId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadData = useCallback(async () => {
    if (!name) return;
    try {
      const [pRes, dRes, dmRes, evRes] = await Promise.all([
        client.api.projects({ name }).get(),
        client.api.projects({ name }).deployments.get(),
        client.api.projects({ name }).domains.index.get(),
        client.api.projects({ name }).env.index.get(),
      ]);
      if (pRes.data?.data) setProject(pRes.data.data as any);
      if (dRes.data?.data) setDeploys(dRes.data.data as any);
      if (dmRes.data?.data) setDomains(dmRes.data.data as any);
      if (evRes.data?.data) setEnvVars(evRes.data.data as any);
    } catch {}
    setLoading(false);
  }, [name]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => { wsRef.current?.close(); };
  }, []);

  function connectLogs(deploymentId: string) {
    // Close previous connection
    wsRef.current?.close();
    setLogs([]);
    setLogStatus(null);
    setLogDeployId(deploymentId);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.VITE_API_URL
      ? new URL(import.meta.env.VITE_API_URL).host
      : window.location.host;
    const ws = new WebSocket(`${proto}//${host}/ws/logs/${deploymentId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg: LogMessage = JSON.parse(event.data);
        if (msg.type === "log" && msg.data) {
          setLogs((prev) => [...prev, msg.data!]);
        } else if (msg.type === "status" && msg.status) {
          setLogStatus(msg.status);
          if (msg.status === "live" || msg.status === "failed") {
            // Refresh deployment list
            loadData();
          }
        }
      } catch {}
    };

    ws.onerror = () => {
      setLogs((prev) => [...prev, "[connection error]"]);
    };

    ws.onclose = () => {
      setLogs((prev) => [...prev, "[stream ended]"]);
    };
  }

  async function addEnvVar() {
    if (!name || !newKey.trim()) return;
    setEnvSaving(true);
    try {
      await client.api.projects({ name }).env.index.post({
        key: newKey.trim(),
        value: newValue,
        isBuildTime: newIsBuild,
      });
      setNewKey("");
      setNewValue("");
      setNewIsBuild(false);
      const res = await client.api.projects({ name }).env.index.get();
      if (res.data?.data) setEnvVars(res.data.data as any);
    } catch {}
    setEnvSaving(false);
  }

  async function deleteEnvVar(key: string) {
    if (!name) return;
    try {
      await client.api.projects({ name }).env({ key }).delete();
      setEnvVars((prev) => prev.filter((v) => v.key !== key));
    } catch {}
  }

  async function addDomain() {
    if (!name || !newDomain.trim()) return;
    setDomainSaving(true);
    try {
      await client.api.projects({ name }).domains.index.post({
        hostname: newDomain.trim().toLowerCase(),
      });
      setNewDomain("");
      const res = await client.api.projects({ name }).domains.index.get();
      if (res.data?.data) setDomains(res.data.data as any);
    } catch {}
    setDomainSaving(false);
  }

  async function deleteDomain(hostname: string) {
    if (!name) return;
    try {
      await client.api.projects({ name }).domains({ hostname }).delete();
      setDomains((prev) => prev.filter((d) => d.hostname !== hostname));
    } catch {}
  }

  async function fetchSavedLogs(deploymentId: string) {
    setLogDeployId(deploymentId);
    setLogs([]);
    setLogStatus(null);
    wsRef.current?.close();
    try {
      const res = await client.api.deployments({ id: deploymentId }).logs.get();
      if (res.data?.data) setLogs(res.data.data as any);
      else setLogs(["[no logs available]"]);
    } catch {
      setLogs(["[no logs available]"]);
    }
  }

  function viewLogs(d: Deployment) {
    if (d.status === "queued" || d.status === "building" || d.status === "deploying" || d.status === "health_checking") {
      connectLogs(d.id);
    } else {
      fetchSavedLogs(d.id);
    }
  }

  async function redeploy() {
    if (!name || redeploying) return;
    setRedeploying(true);
    try {
      const res = await client.api.projects({ name }).redeploy.post();
      if (res.data?.data) {
        setTab("deployments");
        loadData();
        connectLogs((res.data.data as any).deploymentId);
      }
    } catch {}
    setRedeploying(false);
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div className="skeleton" style={{ width: 200, height: 28 }} />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="row">
            <div className="skeleton" style={{ width: "100%", height: 18 }} />
          </div>
        ))}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="empty">
        <div className="empty-title">Project not found</div>
        <Link to="/">Back to projects</Link>
      </div>
    );
  }

  const tabs = ["overview", "deployments", "environment", "domains"];

  return (
    <div>
      <div className="page-header">
        <p className="page-subtitle">
          <Link to="/" style={{ color: "var(--muted)" }}>Projects</Link>
          {" / "}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 className="page-title">{project.name}</h1>
          <button
            className="btn btn-ghost"
            onClick={redeploy}
            disabled={redeploying || !project.latestDeployment}
            style={{ marginTop: 2 }}
          >
            {redeploying ? "Deploying..." : "Redeploy"}
          </button>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t}
            className={`tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>

      {tab === "overview" && (
        <div>
          <div className="kv">
            <span className="kv-key">Framework</span>
            <span className="kv-val">{project.framework}</span>
            <span className="kv-key">Status</span>
            <span className="kv-val">
              {project.latestDeployment
                ? <StatusBadge status={project.latestDeployment.status} />
                : <span style={{ color: "var(--muted)" }}>no deploys</span>}
            </span>
            <span className="kv-key">Domain</span>
            <span className="kv-val mono">
              {domains.length > 0
                ? domains.map((d) => d.hostname).join(", ")
                : project.domain ?? "not configured"}
            </span>
            {project.latestDeployment && (
              <>
                <span className="kv-key">Last deploy</span>
                <span className="kv-val mono">{timeAgo(project.latestDeployment.createdAt)}</span>
                <span className="kv-key">Branch</span>
                <span className="kv-val mono">{project.latestDeployment.branch ?? "main"}</span>
                <span className="kv-key">Image</span>
                <span className="kv-val mono">{project.latestDeployment.runnerImage}</span>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "deployments" && (
        <div>
          {!deploys.length ? (
            <div className="empty">
              <div className="empty-title">No deployments</div>
              <code className="empty-code">voss deploy</code>
            </div>
          ) : (
            <>
              {deploys.map((d) => (
                <div
                  key={d.id}
                  className={`row row-clickable ${logDeployId === d.id ? "row-selected" : ""}`}
                  onClick={() => viewLogs(d)}
                >
                  <StatusBadge status={d.status} />
                  <span className="row-meta">{d.id.slice(0, 8)}</span>
                  <span className="row-meta">{d.branch ?? "main"}</span>
                  <span className="row-meta" style={{ flex: 1, textAlign: "right" }}>
                    {timeAgo(d.createdAt)}
                  </span>
                </div>
              ))}

              {/* Log viewer */}
              {logDeployId && (
                <div className="log-viewer">
                  <div className="log-header">
                    <span className="log-title">
                      Logs: {logDeployId.slice(0, 8)}
                      {logStatus && (
                        <span className="log-status">
                          <StatusBadge status={logStatus} />
                        </span>
                      )}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { wsRef.current?.close(); setLogDeployId(null); setLogs([]); }}
                    >
                      Close
                    </button>
                  </div>
                  <div className="log-body">
                    {logs.length === 0 && (
                      <div className="log-empty">Waiting for logs...</div>
                    )}
                    {logs.map((line, i) => (
                      <div key={i} className="log-line">{line}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "environment" && (
        <div>
          {/* Add env var form */}
          <div className="env-form">
            <input
              className="input"
              placeholder="KEY"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && addEnvVar()}
            />
            <input
              className="input input-wide"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addEnvVar()}
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={newIsBuild}
                onChange={(e) => setNewIsBuild(e.target.checked)}
              />
              Build
            </label>
            <button className="btn btn-primary btn-sm" onClick={addEnvVar} disabled={envSaving || !newKey.trim()}>
              {envSaving ? "Saving..." : "Add"}
            </button>
          </div>

          {/* Env var list */}
          {!envVars.length ? (
            <div className="empty">
              <div className="empty-title">No environment variables</div>
              <p style={{ color: "var(--muted)", fontSize: 13 }}>
                Add variables above or via CLI: <code className="empty-code" style={{ display: "inline", padding: "2px 8px" }}>voss env set KEY value</code>
              </p>
            </div>
          ) : (
            envVars.map((v) => (
              <div key={v.key} className="row">
                <span className="row-name mono">{v.key}</span>
                <span className="row-meta">{v.value}</span>
                {v.isBuildTime && <span className="badge badge-building">build</span>}
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => deleteEnvVar(v.key)}
                >
                  Delete
                </button>
              </div>
            ))
          )}

          <p className="env-hint">
            Variables are encrypted at rest and injected at deploy time. Changes take effect on next deploy.
          </p>
        </div>
      )}

      {tab === "domains" && (
        <div>
          {/* Add domain form */}
          <div className="env-form">
            <input
              className="input input-wide"
              placeholder="example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDomain()}
            />
            <button className="btn btn-primary btn-sm" onClick={addDomain} disabled={domainSaving || !newDomain.trim()}>
              {domainSaving ? "Adding..." : "Add domain"}
            </button>
          </div>

          {!domains.length ? (
            <div className="empty">
              <div className="empty-title">No domains configured</div>
              <p style={{ color: "var(--muted)", fontSize: 13 }}>
                Add a domain above and point its DNS A record to your server IP.
              </p>
            </div>
          ) : (
            domains.map((d) => (
              <div key={d.id} className="row">
                <span className="row-name mono">{d.hostname}</span>
                <span className="row-status">
                  <span className={`dot ${d.sslStatus === "active" ? "dot-live" : "dot-pending"}`} />
                  {d.sslStatus === "active" ? "SSL active" : "SSL pending"}
                </span>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => deleteDomain(d.hostname)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
