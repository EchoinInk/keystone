import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

test("local workerd enforces admission and document ownership with D1 and R2 bindings", async t => {
  const root = fileURLToPath(new URL("../dist/server/", import.meta.url));
  const modules = readdirSync(root, { recursive: true }).filter(name => name.endsWith(".js"));
  const origin = "https://echo-in-ink-founder-os.echoinink.chatgpt.site";
  const compatibility = { compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"] };
  const mf = new Miniflare({
    host: "127.0.0.1", cf: false,
    workers: [
      {
        ...compatibility, name: "dispatch-fixture", modules: true, serviceBindings: { SITE: "site" },
        // Model the Sites boundary using synthetic sessions on a loopback Worker.
        script: `export default { fetch(request, env) {
          const headers = new Headers(request.headers);
          headers.delete("oai-authenticated-user-id");
          headers.set("host", new URL(request.url).host);
          const session = headers.get("cookie");
          if (session === "fixture=founder") headers.set("oai-authenticated-user-id", "fixture-founder");
          if (session === "fixture=other") headers.set("oai-authenticated-user-id", "other");
          return env.SITE.fetch(new Request(request, { headers }));
        } };`,
      },
      {
        ...compatibility, name: "site", modulesRoot: root,
        modules: modules.sort((a, b) => Number(b === "index.js") - Number(a === "index.js"))
          .map(name => ({ type: "ESModule", path: resolve(root, name), contents: readFileSync(resolve(root, name), "utf8") })),
        d1Databases: ["DB"], r2Buckets: ["BUCKET"], bindings: { FOUNDER_USER_ID: "fixture-founder" },
        outboundService: () => new Response(null, { status: 403 }),
      },
    ],
  });
  t.after(() => mf.dispose());
  const request = (path, options) => mf.dispatchFetch(new URL(path, origin).href, options);
  const founderHeaders = { origin, cookie: "fixture=founder" };
  const db = await mf.getD1Database("DB", "site");
  assert.equal((await request("/api/data")).status, 401);
  assert.equal((await request("/api/data", { headers: { cookie: "fixture=other" } })).status, 403);
  assert.equal((await request("/api/files?key=known", {
    headers: { cookie: "fixture=expired", "oai-authenticated-user-id": "fixture-founder" },
  })).status, 401);
  assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='tasks'").first(), null);

  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(name, directory), "utf8").split("--> statement-breakpoint");
    await db.batch(sql.map(statement => db.prepare(statement.trim())));
  }
  assert.equal((await request("/api/data", { headers: founderHeaders })).status, 403);
  await db.prepare("INSERT INTO workspace_owner VALUES (1, ?, ?)").bind(origin, "fixture-founder").run();
  const form = new FormData();
  form.set("file", new File(["verified file"], "proof.txt"));
  const encoded = new Response(form);
  const uploaded = await request("/api/files", {
    method: "POST", headers: { ...founderHeaders, "content-type": encoded.headers.get("content-type") },
    body: await encoded.arrayBuffer(),
  });
  assert.equal(uploaded.status, 200, uploaded.ok ? undefined : await uploaded.text());
  const file = await uploaded.json();
  const mutate = command => request("/api/data", {
    method: "POST", headers: { ...founderHeaders, "content-type": "application/json" }, body: JSON.stringify(command),
  });
  const created = await mutate({ entity: "documents", action: "create", data: file });
  assert.equal(created.status, 200, created.ok ? undefined : await created.text());
  const id = (await created.json()).data.documents[0].id;
  const path = "/api/files?id=" + encodeURIComponent(id);
  assert.equal((await request(path, { headers: { cookie: "fixture=other" } })).status, 403);
  assert.equal(await (await request(path, { headers: founderHeaders })).text(), "verified file");
  assert.equal((await mutate({ entity: "documents", action: "delete", id })).status, 200);
  assert.equal((await request(path, { headers: founderHeaders })).status, 404);
});
