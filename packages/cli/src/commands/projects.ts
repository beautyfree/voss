import { requireCredentials, api } from "../lib/credentials";

export default async function projects(_args: string[]) {
  const creds = requireCredentials();

  const resp = await api(creds, "/api/projects");

  if (!resp.ok) {
    console.error("  ✕ Could not fetch projects");
    process.exit(1);
  }

  const { data } = await resp.json() as any;

  if (!data.length) {
    console.log("  No projects yet. Deploy your first app:");
    console.log("  cd my-app && voss deploy");
    return;
  }

  console.log(`  ${data.length} project${data.length > 1 ? "s" : ""}:\n`);

  for (const p of data) {
    const fw = p.framework.padEnd(8);
    const domain = p.domain ?? `${p.name}.yourdomain.com`;
    console.log(`  ${p.name.padEnd(20)} ${fw} ${domain}`);
  }
}
