import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { StatusDot } from "../components/StatusDot";

interface Project {
  id: string;
  name: string;
  framework: string;
  domain: string | null;
  createdAt: string;
}

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <p className="page-subtitle">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
      </div>
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
