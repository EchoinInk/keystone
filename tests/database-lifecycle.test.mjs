import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { normalizeStatuses } from "../scripts/normalize-status.mjs";
import { applicationTables, migrate, migrations } from "../scripts/migrations.mjs";
import { seedFounderTemplate } from "../scripts/founder-template.mjs";
import { call, fixture } from "./fixtures/workspace.mjs";

async function disposableD1(t) {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", cf: false, modules: true, script: "export default {};",
    compatibilityDate: "2026-05-15", d1Databases: ["DB"],
  }));
  t.after(() => runtime.dispose());
  return runtime.getD1Database("DB");
}
const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const names = migrations.map(m => m.name);

test("adopts partial historical DDL, normalizes legacy statuses once and preserves owner data", async t => {
  const db = await disposableD1(t);
  const legacyColumns = migrations[2].sql.filter(s => s.startsWith("ALTER TABLE")).slice(0, 3);
  await db.batch([...migrations[0].sql, ...migrations[1].sql, ...legacyColumns].map(s => db.prepare(s)));
  await db.prepare("INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES('old','Keep me','Done','before','then')").run();
  const note = "SELECT * FROM notes";
  await db.prepare("INSERT INTO notes(id,title,body,created_at,updated_at) VALUES('n','Original','Exact bytes','a','b')").run();
  await db.prepare("INSERT INTO invoices(id,number,amount,tax,status,created_at,updated_at) VALUES('historical','H-001',100.01,15,'Paid','a','b')").run();
  await db.prepare("INSERT INTO payments(id,invoice_id,amount,paid_at,reference,created_at,updated_at) VALUES('receipt','historical',20,'2025-12-31','original','a','b')").run();
  const ledgerRows = async () => [await rows(db,"SELECT * FROM invoices"), await rows(db,"SELECT * FROM payments")];
  const ledgerBefore = await ledgerRows();
  const before = await rows(db, note);
  assert.deepEqual(await migrate(db), names);
  assert.deepEqual(await ledgerRows(), ledgerBefore);
  assert.equal(await normalizeStatuses(db), "normalized");
  assert.deepEqual(await rows(db, note), before);
  assert.deepEqual(await rows(db, "SELECT title,status,completed_at,updated_at FROM tasks"), [
    { title: "Keep me", status: "Completed", completed_at: "then", updated_at: "then" },
  ]);
  assert.deepEqual(await rows(db, "PRAGMA foreign_key_check"), []);
  await db.prepare("UPDATE tasks SET status='In review'").run();
  assert.deepEqual(await migrate(db), []);
  assert.equal(await normalizeStatuses(db), "already normalized");
  assert.deepEqual(await rows(db, note), before);
  assert.equal((await db.prepare("SELECT status FROM tasks").first()).status, "In review");
  assert.deepEqual((await rows(db, "SELECT name FROM d1_migrations ORDER BY id")).map(r => r.name), names);
  await assert.rejects(seedFounderTemplate(db, applicationTables()), /empty application database/);
});

test("a failed migration rolls back its DDL and retries from the last durable ledger entry", async t => {
  const db = await disposableD1(t);
  await db.prepare("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare(`CREATE TRIGGER stop_migration BEFORE INSERT ON d1_migrations
    WHEN NEW.name='0007_founder_workspace.sql' BEGIN SELECT RAISE(ABORT,'simulated interruption'); END`).run();
  await assert.rejects(migrate(db), /simulated interruption/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM d1_migrations").first("n"), 7);
  assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='workspace_owner'").first(), null);
  await db.prepare("DROP TRIGGER stop_migration").run();
  assert.deepEqual(await migrate(db), names.slice(7));
  assert.deepEqual(await migrate(db), []);
});

test("incompatible untracked schema fails before adopting or altering anything", async t => {
  const db = await disposableD1(t);
  await db.prepare("CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT)").run();
  await assert.rejects(migrate(db), /Incompatible legacy schema for notes/);
  assert.deepEqual(await rows(db, "SELECT name FROM sqlite_schema WHERE name IN ('d1_migrations','tasks')"), []);
});

test("an interrupted status backfill preserves task values and its retry marker", async t => {
  const db = await disposableD1(t);
  await migrate(db);
  await db.prepare("INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES('old','Original','Done','a','b')").run();
  await db.prepare("CREATE TRIGGER stop_backfill BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'stop backfill'); END").run();
  await assert.rejects(normalizeStatuses(db), /stop backfill/);
  assert.equal(await db.prepare("SELECT status FROM tasks").first("status"), "Done");
  assert.equal(await db.prepare("SELECT count(*) n FROM system_meta").first("n"), 0);
  await db.prepare("DROP TRIGGER stop_backfill").run();
  assert.equal(await normalizeStatuses(db), "normalized");
  assert.equal(await db.prepare("SELECT status FROM tasks").first("status"), "Completed");
});

test("seed installation rolls back on failure, retries atomically and preserves later edits", async t => {
  const db = await disposableD1(t);
  await migrate(db);
  const tables = applicationTables();
  await normalizeStatuses(db);
  await db.prepare("CREATE TRIGGER simulate_failure BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
  await assert.rejects(seedFounderTemplate(db, tables), /fixture failure/);
  for (const name of ["clients", "services", "tasks"]) {
    assert.equal(await db.prepare(`SELECT count(*) AS n FROM ${name}`).first("n"), 0);
  }
  assert.equal(await db.prepare("SELECT count(*) AS n FROM system_meta").first("n"), 1);
  await db.prepare("DROP TRIGGER simulate_failure").run();
  assert.equal(await seedFounderTemplate(db, tables), "installed");
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM tasks").first("n"), 17);
  await db.prepare("UPDATE professional_profiles SET name='Edited'").run();
  assert.equal(await seedFounderTemplate(db, tables), "already installed");
  assert.equal(await db.prepare("SELECT name FROM professional_profiles").first("name"), "Edited");
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM workspace_owner").first("n"), 0);
  assert.deepEqual(await rows(db, "PRAGMA foreign_key_check"), []);
});

test("admitted reads, writes and assistant requests never migrate or repair an opted-in workspace", async () => {
  const { env, sql } = fixture();
  sql.exec(`INSERT INTO system_meta VALUES('founder-templates','enabled','old');
    INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES('legacy','Sentinel','Done','old','old')`);
  const statements = [];
  const original = env.DB.prepare;
  env.DB.prepare = query => { statements.push(query); return original(query); };
  const user = env.FOUNDER_USER_ID;
  for (let i = 0; i < 2; i++) assert.equal((await call(env, "/api/data", { user })).status, 200);
  assert.ok(statements.every(s => /^SELECT\b/i.test(s)));
  assert.equal((await call(env, "/api/data", { user, json: { entity: "tasks", action: "create", data: { title: "New task" } } })).status, 200);
  assert.equal((await call(env, "/api/assistant", { user, json: { page: "Tasks", prompt: "How many?" } })).status, 200);
  for (const query of statements) {
    assert.match(query, /^(SELECT\b|INSERT INTO (tasks|activity_logs|revisions|ai_conversations|command_receipts)\b)/i);
    assert.doesNotMatch(query, /\b(system_meta|d1_migrations|sqlite_schema|sqlite_master)\b/i);
  }
  assert.equal(sql.prepare("SELECT status FROM tasks WHERE id='legacy'").get().status, "Done");
  assert.equal(sql.prepare("SELECT status FROM tasks WHERE title='New task'").get().status, "To do");
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM clients").get().n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM system_meta").get().n, 1);
});
