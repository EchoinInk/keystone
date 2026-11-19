import { getRuntimeEnv } from "../../../db/runtime";
import { entities, snake } from "./entities";

// Capture every affected row inside the same batch. The selection is evaluated
// before the update, so concurrent links and their before-images agree.
export function updateRelated(entity: string, where: string, criteria: unknown[], set: string, values: unknown[],
  timestamp: string, key: string, label: string) {
  const { DB } = getRuntimeEnv();
  const { table, columns, category } = entities[entity];
  const snapshot = ["id", ...columns, "createdAt", "updatedAt"].map(k => `'${k}',${snake(k)}`).join(",");
  const id = "lower(hex(randomblob(16)))";
  return [
    DB.prepare(`INSERT INTO revisions (id,entity,record_id,action,snapshot,created_at,updated_at)
      SELECT ${id},?,id,'update',json_object(${snapshot}),?,? FROM ${table} WHERE ${where}`)
      .bind(entity, timestamp, timestamp, ...criteria),
    DB.prepare(`INSERT INTO activity_logs (id,category,action,entity,record_id,label,metadata,created_at,updated_at)
      SELECT ${id},?,'update',?,id,?,?,?,? FROM ${table} WHERE ${where}`)
      .bind(category, entity, label, JSON.stringify({ source: "Founder OS", requestId: key }), timestamp, timestamp, ...criteria),
    DB.prepare(`UPDATE ${table} SET ${set}, updated_at=CASE WHEN updated_at>=? AND julianday(updated_at) IS NOT NULL
      THEN strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+0.001 seconds') ELSE ? END WHERE ${where}`)
      .bind(...values, timestamp, timestamp, ...criteria),
  ];
}
