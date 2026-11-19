import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadWorkerInNode } from "../../scripts/load-worker-in-node.mjs";
const worker = await loadWorkerInNode();

export const origin = "https://echo-in-ink-founder-os.echoinink.chatgpt.site";
const migrations = new URL("../../drizzle/", import.meta.url);

export function fixture(subject = "owner-one", legacy = () => {}) {
  const sql = new DatabaseSync(":memory:");
  for (const name of readdirSync(migrations).filter(s => s.endsWith(".sql")).sort()) {
    if (name.startsWith("0007_")) legacy(sql);
    sql.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  sql.prepare("INSERT INTO workspace_owner VALUES (1, ?, ?)").run(origin, subject);
  return bindWorkspace(sql, subject);
}

export function bindWorkspace(sql, subject, objects = new Map()) {
  const counts = { queries: 0, reads: 0, writes: 0 };
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
      async put(key, blob, options) {
        if (options?.onlyIf && objects.has(key)) return null;
        counts.writes++;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const etag = createHash("md5").update(bytes).digest("hex");
        objects.set(key, { bytes, etag, checksums: { sha256: Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer } });
        return { etag };
      },
      async head(key) { return objects.get(key) ?? null; },
      async delete(key) { objects.delete(key); },
      async list({ prefix, limit, cursor }) {
        const keys = [...objects.keys()].filter(k => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
        const page = keys.slice(0, limit);
        return { objects: page.map(key => ({ key })), truncated: keys.length > limit, cursor: page.at(-1) };
      },
      async get(key) {
        counts.reads++;
        const object = objects.get(key);
        return object ? { etag: object.etag, checksums: object.checksums, body: new Response(object.bytes).body } : null;
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
  if (method === "POST" && !h.has("Idempotency-Key")) h.set("Idempotency-Key", crypto.randomUUID());
  if (method === "POST" && !h.has("origin")) h.set("origin", origin);
  if (json) h.set("content-type", "application/json");
  const request = new Request(new URL(path, host), {
    method, headers: h, body: json ? JSON.stringify(json) : form,
  });
  return worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
}
