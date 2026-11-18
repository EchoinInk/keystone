import { readFileSync } from "node:fs";

export const statusNormalizationKey = "task-status-normalization-v1";
const sql = readFileSync(new URL("./sql/normalize-task-status.sql", import.meta.url), "utf8");

export async function normalizeStatuses(db) {
  const marker = await db.prepare("SELECT value FROM system_meta WHERE key = ?").bind(statusNormalizationKey).first();
  if (marker?.value === "complete") return "already normalized";
  if (marker) throw new Error("Unexpected task status maintenance marker; review the database.");
  // A concurrent run must acquire this unique key in the same transaction.
  // Any failed update rolls the marker back, making the operation retryable.
  await db.batch([
    db.prepare("INSERT INTO system_meta (key,value,updated_at) VALUES (?, 'complete', ?)").bind(statusNormalizationKey, new Date().toISOString()),
    ...sql.split("--> statement-breakpoint").map(statement => db.prepare(statement.trim())),
  ]);
  return "normalized";
}
