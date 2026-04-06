import { useState } from "react";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const resp = await fetch("/api/projects", {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (resp.ok) {
        localStorage.setItem("voss_api_key", key);
        onLogin();
      } else {
        setError("Invalid API key");
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "var(--bg)",
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 360,
        padding: 32,
      }}>
        <div style={{
          fontFamily: "var(--mono)",
          fontSize: 28,
          fontWeight: 700,
          marginBottom: 32,
          textAlign: "center",
        }}>
          voss
        </div>

        <input
          type="password"
          placeholder="API Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          style={{
            width: "100%",
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid ${error ? "var(--error)" : "var(--border)"}`,
            borderRadius: "var(--radius-md)",
            color: "var(--text)",
            fontSize: 14,
            fontFamily: "var(--mono)",
            outline: "none",
          }}
        />

        {error && (
          <div style={{ color: "var(--error)", fontSize: 13, marginTop: 8 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !key}
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 16, justifyContent: "center" }}
        >
          {loading ? "Connecting..." : "Login"}
        </button>

        <p style={{
          color: "var(--muted)",
          fontSize: 12,
          textAlign: "center",
          marginTop: 24,
        }}>
          Find your API key in /etc/voss/config.json on the server
        </p>
      </form>
    </div>
  );
}
