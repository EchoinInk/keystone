import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { providerAnswer } from "./fixtures/assistant.mjs";
import { call, fixture, origin } from "./fixtures/workspace.mjs";

const founder = "pilot-founder";
const other = "another-member";
const cmd = (entity, action, args = {}) => ({ entity, action, ...args });
const write = (env, json, user = founder) => call(env, "/api/data", { user, json });
const snapshot = async (env, user = founder) => {
  const response = await call(env, "/api/data", { user });
  assert.equal(response.status, 200);
  return (await response.json()).data;
};
const upload = async (env, user = founder, text = "private bytes") => {
  const form = new FormData();
  form.set("file", new File([text], "notes.html", { type: "text/html" }));
  const response = await call(env, "/api/files", { user, form });
  assert.equal(response.status, 200);
  return response.json();
};

test("Worker rejects unauthenticated and unadmitted requests before storage, bootstrap or provider access", async t => {
  const { env, counts } = fixture(founder);
  env.OPENAI_API_KEY = "fixture-only";
  const provider = t.mock.method(globalThis, "fetch", () => { throw Error("Unexpected provider call"); });
  for (const [path, method] of [
    ["/", "GET"], ["/assets/app.js", "GET"], ["/_vinext/image", "GET"], ["/api/data", "GET"],
    ["/api/data", "HEAD"], ["/api/data", "POST"], ["/api/files?key=known", "GET"], ["/api/files?key=known", "HEAD"], ["/api/files", "POST"], ["/api/assistant", "POST"], ["/api/assistant?id=known", "GET"],
  ]) {
    for (const [user, status] of [[undefined, 401], [other, 403]]) {
      const response = await call(env, path, { user, method, headers: { "oai-authenticated-user-email": "founder@example.test" } });
      assert.equal(response.status, status, method + " " + path);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  }
  assert.deepEqual(counts, { queries: 0, reads: 0, writes: 0 });
  const signedOut = await call(env, "/", { headers: { accept: "text/html" } });
  assert.equal(signedOut.status, 401);
  assert.match(await signedOut.text(), /signin-with-chatgpt/);
  assert.equal(provider.mock.callCount(), 0);
});

test("canonical origin, same-origin writes and administrator admission fail closed", async () => {
  const { env, counts, sql } = fixture(founder);
  for (const host of ["https://alternate.workers.dev", "http://localhost", "https://preview.example"]) {
    const response = await call(env, "/api/data", { user: founder, host, headers: { "x-forwarded-host": new URL(origin).host } });
    assert.equal(response.status, 403);
  }
  for (const caller of ["null", "https://elsewhere.example", ""]) {
    assert.equal((await call(env, "/api/assistant", { user: founder, method: "POST", headers: { origin: caller } })).status, 403);
  }
  assert.equal((await call({ ...env, FOUNDER_USER_ID: undefined }, "/api/data", { user: founder })).status, 503);
  assert.equal(counts.queries, 0);
  assert.equal((await call({ ...env, FOUNDER_USER_ID: other }, "/api/data", { user: other })).status, 403);
  sql.exec("DELETE FROM workspace_owner");
  assert.equal((await call(env, "/api/data", { user: founder })).status, 403);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM tasks").get().n, 0);
  sql.exec("DROP TABLE workspace_owner");
  assert.equal((await call(env, "/api/files?key=test", { user: founder })).status, 503);
  assert.equal(counts.reads, 0);
});

test("concurrent founder-bound requests isolate records, historic rows, IDs, writes and side effects", async () => {
  function addRows(key) {
    return db => db.prepare("INSERT INTO notes(id,title,body,created_at,updated_at) VALUES(?, ?, 'saved before Phase 1','then','then')").run(key, key);
  }
  const a = fixture(founder, addRows("original-a"));
  const b = fixture(other, addRows("original-b"));
  const [da, db] = await Promise.all([snapshot(a.env), snapshot(b.env, other)]);
  assert.deepEqual(da.notes.map(r => r.id), ["original-a"]);
  assert.deepEqual(db.notes.map(r => r.id), ["original-b"]);
  for (const name of ["tasks", "knowledge", "clients", "professionalProfiles", "aiConversations"]) assert.deepEqual(db[name], []);
  assert.equal(da.notes[0].body, "saved before Phase 1");
  assert.equal(Object.keys(da).length, 41);
  for (const [action, args] of [
    ["update", { id: "original-b", data: { title: "changed" } }], ["delete", { id: "original-b" }],
    ["duplicate", { id: "original-b" }], ["bulkDelete", { ids: ["original-a", "original-b"] }],
  ]) assert.equal((await write(a.env, cmd("notes", action, args))).status, 404);
  assert.equal((await write(a.env, cmd("notes", "update", { id: "original-a", data: { title: "owner edit" } }))).status, 200);
  assert.equal((await write(a.env, cmd("notes", "delete", { id: "original-a" }), other)).status, 403);
  assert.equal((await write(a.env, cmd("tasks", "create", { data: { title: "unowned parent", objectiveId: "other-only" } }))).status, 404);
  for (const payload of [
    { workspaceId: "other" }, { data: { owner_id: other } }, { data: { userId: other } },
  ]) assert.equal((await write(a.env, cmd("notes", "update", { id: "original-a", ...payload }))).status, 403);
  assert.equal(a.sql.prepare("SELECT subject FROM workspace_owner").get().subject, founder);
  assert.equal(a.sql.prepare("SELECT title FROM notes WHERE id='original-a'").get().title, "owner edit");
  assert.equal(b.sql.prepare("SELECT title FROM notes WHERE id='original-b'").get().title, "original-b");
  assert.equal(b.sql.prepare("SELECT COUNT(*) n FROM revisions").get().n, 0);
  assert.equal((await write(a.env, cmd("notes", "delete", { id: "original-a" }))).status, 200);
  assert.equal((await snapshot(a.env)).notes.length, 0);
});

test("attachment claims, replacements, shared references and final revocation are workspace controlled", async () => {
  const a = fixture(founder);
  const b = fixture(other);
  const file = await upload(a.env);
  assert.match(file.objectKey, /^workspaces\/[a-f0-9]{64}\//);
  const byKey = "/api/files?key=" + encodeURIComponent(file.objectKey);
  assert.equal((await call(a.env, byKey, { user: founder })).status, 404);
  assert.equal((await write(b.env, cmd("documents", "create", { data: file }), other)).status, 404);
  assert.equal((await write(a.env, cmd("documents", "create", { data: { ...file, projectId: "unowned" } }))).status, 404);
  const create = await write(a.env, cmd("documents", "create", { data: { ...file, size: 0 } }));
  assert.equal(create.status, 200);
  const [doc] = (await create.json()).data.documents;
  assert.equal(doc.size, file.size);
  const byId = "/api/files?id=" + encodeURIComponent(doc.id);
  const download = await call(a.env, byId, { user: founder });
  assert.equal(await download.text(), "private bytes");
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await call(a.env, byKey, { user: other })).status, 403);
  assert.equal((await call(b.env, byKey, { user: other })).status, 404);
  assert.equal(b.counts.reads, 0);
  const foreign = await upload(b.env, other);
  assert.equal((await write(a.env, cmd("documents", "update", { id: doc.id, data: foreign }))).status, 404);
  assert.equal((await write(a.env, cmd("documents", "duplicate", { id: doc.id }))).status, 200);
  const second = await upload(a.env, founder, "replacement");
  assert.equal((await write(a.env, cmd("documents", "update", { id: doc.id, data: second }))).status, 200);
  assert.equal(await (await call(a.env, byId, { user: founder })).text(), "replacement");
  assert.equal(await (await call(a.env, byKey, { user: founder })).text(), "private bytes");
  const ids = (await snapshot(a.env)).documents.map(r => r.id);
  assert.equal((await write(a.env, cmd("documents", "bulkDelete", { ids }))).status, 200);
  for (const path of [byId, byKey]) assert.equal((await call(a.env, path, { user: founder })).status, 404);
  for (const data of [file, second]) assert.equal((await write(a.env, cmd("documents", "create", { data }))).status, 404);
});

test("reviewed legacy attachment keeps its ID, key and digest; mismatched bytes stay inaccessible", async () => {
  const { env, sql, objects, counts } = fixture(founder, db => {
    db.exec("INSERT INTO documents(id,name,object_key,content_type,size,created_at,updated_at) VALUES('old-id','old.txt','legacy/key','text/plain',6,'old','old')");
  });
  const bytes = new TextEncoder().encode("legacy");
  const etag = createHash("md5").update(bytes).digest("hex");
  objects.set("legacy/key", { bytes, etag });
  const path = "/api/files?key=legacy%2Fkey";
  assert.equal((await call(env, path, { user: founder })).status, 404);
  assert.equal(counts.reads, 0);
  sql.prepare("INSERT INTO workspace_files VALUES(?, ?, ?, ?, ?)").run("legacy/key", etag, "old.txt", "text/plain", 6);
  const restored = await call(env, path, { user: founder });
  assert.equal(restored.status, 200);
  const sha = data => createHash("sha256").update(data).digest("hex");
  assert.equal(sha(await restored.bytes()), sha(bytes));
  assert.equal((await snapshot(env)).documents[0].id, "old-id");
  objects.set("legacy/key", { bytes: new Uint8Array(), etag: "changed" });
  assert.equal((await call(env, path, { user: founder })).status, 404);
});

test("assistant uses only the admitted database and writes server-owned, linked history", async t => {
  const { env, sql } = fixture(founder);
  await snapshot(env);
  const task = await write(env, cmd("tasks", "create", { data: { title: "only-in-one" } }));
  assert.equal(task.status, 200);
  const b = fixture(other);
  await snapshot(b.env, other);
  assert.equal((await write(b.env, cmd("tasks", "create", { data: { title: "second-private-task" } }), other)).status, 200);
  const provider = t.mock.method(globalThis, "fetch", () => providerAnswer("fixture answer"));
  env.OPENAI_API_KEY = "test-only";
  const json = { page: "Tasks", prompt: "what is next?", mode: "review" };
  assert.equal((await call(env, "/api/assistant", { user: other, json })).status, 403);
  assert.equal((await call(env, "/api/assistant", { user: founder, json: {...json, workspaceId:"other", context:"untrusted"} })).status, 400);
  const preview = await (await call(env, "/api/assistant", { user: founder, json })).json();
  assert.equal(preview.providerStatus, "pending");
  assert.equal(provider.mock.callCount(), 0);
  const decision = {action:"approve", conversationId:preview.id};
  assert.equal((await call(env, "/api/assistant", { user: other, json:decision })).status, 403);
  assert.equal((await call(b.env, "/api/assistant", { user: other, json:decision })).status, 404);
  const answer = await (await call(env, "/api/assistant", { user: founder, json:decision })).json();
  assert.equal(answer.response, "fixture answer");
  assert.equal(provider.mock.callCount(), 1);
  const context = JSON.parse(provider.mock.calls[0].arguments[1].body).input;
  assert.equal(context, preview.preview);
  assert.ok(context.includes("only-in-one"));
  assert.ok(!context.includes("second-private-task"));
  assert.ok(!context.includes("untrusted"));
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM activity_logs a JOIN ai_conversations c ON a.record_id=c.id WHERE a.entity='aiConversations'").get().n, 1);
  assert.equal(b.sql.prepare("SELECT COUNT(*) n FROM ai_conversations").get().n, 0);
  for (const entity of ["revisions", "activityLogs", "aiConversations"]) {
    for (const action of ["create", "update", "duplicate", "delete", "bulkDelete"]) {
      assert.equal((await write(env, cmd(entity, action, { id: "known" }))).status, 403);
    }
  }
  for (const entity of ["workspace_owner", "workspaceFiles", "systemMeta", "constructor"]) {
    assert.equal((await write(env, cmd(entity, "create"))).status, 400);
  }
});

test("deployment artifact routes through the Worker first and disables alternate Worker URLs", () => {
  const config = JSON.parse(readFileSync(new URL("../dist/server/wrangler.json", import.meta.url)));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.binding, "ASSETS");
  assert.deepEqual(config.triggers?.crons ?? [], []);
  assert.deepEqual(config.queues?.consumers ?? [], []);
});
