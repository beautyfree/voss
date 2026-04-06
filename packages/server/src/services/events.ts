import { getDb, schema } from "../db";

export function logEvent(
  projectId: string,
  type: string,
  message: string,
  meta: Record<string, any> = {},
) {
  const db = getDb();
  db.insert(schema.events)
    .values({
      id: crypto.randomUUID(),
      projectId,
      type,
      message,
      meta: JSON.stringify(meta),
      createdAt: new Date().toISOString(),
    })
    .run();
}
