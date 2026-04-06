import { getDb, schema } from "../db";
import { eq } from "drizzle-orm";

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

export function startSslChecker() {
  // Run immediately, then every hour
  checkAllDomains();
  setInterval(checkAllDomains, CHECK_INTERVAL);
}

async function checkAllDomains() {
  const db = getDb();
  const domains = db.select().from(schema.domains).all();

  for (const domain of domains) {
    try {
      const resp = await fetch(`https://${domain.hostname}/`, {
        signal: AbortSignal.timeout(10000),
      });
      // If we get any response over HTTPS, SSL is active
      const newStatus = "active";
      if (domain.sslStatus !== newStatus) {
        db.update(schema.domains)
          .set({ sslStatus: newStatus })
          .where(eq(schema.domains.id, domain.id))
          .run();
        console.log(`[ssl] ${domain.hostname}: ${domain.sslStatus} → ${newStatus}`);
      }
    } catch {
      // HTTPS failed — could be DNS not pointed, cert not issued yet, etc.
      if (domain.sslStatus === "active") {
        db.update(schema.domains)
          .set({ sslStatus: "error" })
          .where(eq(schema.domains.id, domain.id))
          .run();
        console.log(`[ssl] ${domain.hostname}: active → error`);
      }
    }
  }
}
