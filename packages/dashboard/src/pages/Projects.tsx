import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { StatusDot } from "../components/StatusDot";
import { toast } from "../components/Toast";

interface Project {
  id: string;
  name: string;
  framework: string;
  domain: string | null;
  createdAt: string;
}

interface Template {
  id: string;
  name: string;
  description: string;
  framework: string;
  services?: Record<string, boolean>;
}

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [newName, setNewName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api<Project[]>("/api/projects")
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Projects</h1>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="row">
            <div className="skeleton" style={{ width: 180, height: 18 }} />
            <div className="skeleton" style={{ width: 80, height: 14 }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty">
        <div className="empty-title">Could not load projects</div>
        <p>{error}</p>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Projects</h1>
        </div>
        <div className="empty">
          <div className="empty-title">No projects yet</div>
          <p>Deploy your first app from the terminal</p>
          <code className="empty-code">voss deploy</code>
        </div>
      </div>
    );
  }

  async function createFromTemplate() {
    if (!newName.trim() || !selectedTemplate || creating) return;
    setCreating(true);
    try {
      const result = await api<{ name: string }>("/api/projects/from-template", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim().toLowerCase(), templateId: selectedTemplate }),
      });
      toast(`Project ${result.name} created`, "success");
      setShowNewProject(false);
      setNewName("");
      setSelectedTemplate("");
      navigate(`/projects/${result.name}`);
    } catch (e) { toast((e as Error).message, "error"); }
    setCreating(false);
  }

  function openNewProject() {
    setShowNewProject(true);
    if (!templates.length) {
      api<Template[]>("/api/projects/templates").then(setTemplates).catch(() => {});
    }
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="page-title">Projects</h1>
          <button className="btn btn-primary btn-sm" onClick={openNewProject}>New Project</button>
        </div>
        <p className="page-subtitle">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
      </div>

      {showNewProject && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Create from Template</h3>
          <div className="env-form" style={{ marginBottom: 12 }}>
            <input className="input" placeholder="project-name" value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && createFromTemplate()} autoFocus />
            <button className="btn btn-primary btn-sm" onClick={createFromTemplate}
              disabled={creating || !newName.trim() || !selectedTemplate}>
              {creating ? "Creating..." : "Create"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNewProject(false)}>Cancel</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {templates.map((t) => (
              <div key={t.id}
                onClick={() => setSelectedTemplate(t.id)}
                style={{
                  padding: "12px 14px", borderRadius: 6, cursor: "pointer",
                  border: `1px solid ${selectedTemplate === t.id ? "var(--accent)" : "var(--border)"}`,
                  background: selectedTemplate === t.id ? "rgba(0,112,243,0.08)" : "transparent",
                }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{t.description}</div>
                {t.services && (
                  <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 6 }}>
                    {Object.keys(t.services).join(" + ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.map((p) => (
        <Link to={`/projects/${p.name}`} key={p.id} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="row">
            <div className="row-name">{p.name}</div>
            <span className="row-meta">{p.framework}</span>
            <span className="row-meta">{p.domain ?? ""}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
