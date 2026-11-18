import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../../dist/server/index.js";

export const origin = "https://echo-in-ink-founder-os.echoinink.chatgpt.site";
const migrations = new URL("../../drizzle/", import.meta.url);

export function fixture(subject = "owner-one", legacy = () => {}) {
  const sql = new DatabaseSync(":memory:");
  const counts = { queries: 0, reads: 0, writes: 0 };
  for (const name of readdirSync(migrations).filter(s => s.endsWith(".sql")).sort()) {
    if (name.startsWith("0007_")) legacy(sql);
    sql.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  sql.prepare("INSERT INTO workspace_owner VALUES (1, ?, ?)").run(origin, subject);
  function prepare(query, values = []) {
    counts.queries++;
    const stmt = sql.prepare(query);
    return {
      bind: (...args) => prepare(query, args.map(v => typeof v === "boolean" ? Number(v) : v)),
      first: () => stmt.get(...values) ?? null,
      all: () => ({ results: stmt.all(...values) }),
      run: () => stmt.run(...values),
    };
  }
  const objects = new Map();
  const env = {
    FOUNDER_USER_ID: subject,
    DB: { prepare, batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = statements.map(statement => statement.all());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    } },
    BUCKET: {
      async put(key, blob) {
        counts.writes++;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const etag = createHash("md5").update(bytes).digest("hex");
        objects.set(key, { bytes, etag });
        return { etag };
      },
      async get(key) {
        counts.reads++;
        const object = objects.get(key);
        return object ? { etag: object.etag, body: new Response(object.bytes).body } : null;
      },
    },
    ASSETS: { fetch: () => new Response("static fixture") },
  };
  return { env, sql, counts, objects };
}

export function call(env, path, { user, method = "GET", json, form, headers = {}, host = origin } = {}) {
  const h = new Headers(headers);
  if (user) h.set("oai-authenticated-user-id", user);
  if (json || form) method = "POST";
  if (method === "POST" && !h.has("origin")) h.set("origin", origin);
  if (json) h.set("content-type", "application/json");
  const request = new Request(new URL(path, host), {
    method, headers: h, body: json ? JSON.stringify(json) : form,
  });
  return worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
}
