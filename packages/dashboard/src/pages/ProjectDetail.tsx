import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
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

export function ProjectDetail() {
  const { name } = useParams<{ name: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [deploys, setDeploys] = useState<Deployment[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name) return;
    Promise.all([
      api<ProjectData>(`/api/projects/${name}`),
      api<Deployment[]>(`/api/projects/${name}/deployments`),
      api<Domain[]>(`/api/projects/${name}/domains`),
    ])
      .then(([p, d, dm]) => { setProject(p); setDeploys(d); setDomains(dm); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [name]);

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

  const tabs = ["overview", "deployments", "domains"];

  return (
    <div>
      <div className="page-header">
        <p className="page-subtitle">
          <Link to="/" style={{ color: "var(--muted)" }}>Projects</Link>
          {" / "}
        </p>
        <h1 className="page-title">{project.name}</h1>
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
            deploys.map((d) => (
              <div key={d.id} className="row">
                <StatusBadge status={d.status} />
                <span className="row-meta">{d.id.slice(0, 8)}</span>
                <span className="row-meta">{d.branch ?? "main"}</span>
                <span className="row-meta" style={{ flex: 1, textAlign: "right" }}>
                  {timeAgo(d.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "domains" && (
        <div>
          {!domains.length ? (
            <div className="empty">
              <div className="empty-title">No domains configured</div>
              <code className="empty-code">voss domains add example.com</code>
            </div>
          ) : (
            domains.map((d) => (
              <div key={d.id} className="row">
                <span className="row-name mono">{d.hostname}</span>
                <span className="row-status">
                  <span className={`dot ${d.sslStatus === "active" ? "dot-live" : "dot-pending"}`} />
                  {d.sslStatus === "active" ? "SSL active" : "SSL pending"}
                </span>
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
