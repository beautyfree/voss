import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Projects", icon: "□" },
  { to: "/server", label: "Server", icon: "◈" },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">voss</div>
      <nav className="sidebar-nav">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === "/"}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "active" : ""}`
            }
          >
            <span>{l.icon}</span>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span style={{ color: "var(--muted)", fontSize: 12, fontFamily: "var(--mono)" }}>
          v0.1.0
        </span>
      </div>
    </aside>
  );
}
