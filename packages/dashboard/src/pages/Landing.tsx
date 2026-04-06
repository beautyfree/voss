export function Landing({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="landing">
      <div className="landing-hero">
        <h1 className="landing-title">voss</h1>
        <p className="landing-sub">Deploy to your own VPS. Self-hosted Vercel alternative.</p>
        <div className="landing-install">
          <code>curl -fsSL https://get.voss.dev | sudo bash</code>
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
          <button className="btn btn-primary" onClick={onLogin}>
            Dashboard Login
          </button>
          <a
            href="https://github.com/beautyfree/voss"
            target="_blank"
            rel="noopener"
            className="btn btn-ghost"
          >
            GitHub
          </a>
        </div>
      </div>

      <div className="landing-features">
        <div className="feature-card">
          <div className="feature-title">Zero config deploys</div>
          <p className="feature-desc">Auto-detects Next.js, Vite, Astro, Remix, Nuxt, SvelteKit, Dockerfile. Just push.</p>
        </div>
        <div className="feature-card">
          <div className="feature-title">Your server, your rules</div>
          <p className="feature-desc">Single VPS. No vendor lock-in. Full SSH access. Pay only for the server.</p>
        </div>
        <div className="feature-card">
          <div className="feature-title">Auto-SSL & domains</div>
          <p className="feature-desc">Let's Encrypt certificates. Custom domains. Traefik reverse proxy. All automatic.</p>
        </div>
        <div className="feature-card">
          <div className="feature-title">Preview deploys</div>
          <p className="feature-desc">Every PR gets its own URL. GitHub webhook auto-deploy. Cleanup on merge.</p>
        </div>
        <div className="feature-card">
          <div className="feature-title">Instant rollback</div>
          <p className="feature-desc">One-click rollback to previous deployment. Alias-based, no rebuild needed.</p>
        </div>
        <div className="feature-card">
          <div className="feature-title">Dashboard & CLI</div>
          <p className="feature-desc">Web dashboard for monitoring. CLI for everything. Eden Treaty typed API.</p>
        </div>
      </div>

      <div className="landing-compare">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, textAlign: "center" }}>
          vs Vercel
        </h2>
        <div className="compare-table">
          <div className="compare-row compare-header">
            <span />
            <span>voss</span>
            <span>Vercel</span>
          </div>
          <div className="compare-row">
            <span>Pricing</span>
            <span className="compare-good">$5/mo VPS</span>
            <span>$20/mo + usage</span>
          </div>
          <div className="compare-row">
            <span>Bandwidth</span>
            <span className="compare-good">Unlimited</span>
            <span>100GB then $0.15/GB</span>
          </div>
          <div className="compare-row">
            <span>Build time</span>
            <span className="compare-good">Unlimited</span>
            <span>6000 min/mo</span>
          </div>
          <div className="compare-row">
            <span>Data residency</span>
            <span className="compare-good">You choose</span>
            <span>AWS regions</span>
          </div>
          <div className="compare-row">
            <span>Vendor lock-in</span>
            <span className="compare-good">None</span>
            <span>High</span>
          </div>
          <div className="compare-row">
            <span>SSH access</span>
            <span className="compare-good">Full</span>
            <span>None</span>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)", fontSize: 13 }}>
        Open source &middot; MIT License &middot; github.com/beautyfree/voss
      </div>
    </div>
  );
}
