import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../drizzle/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory)));
export const migrations = journal.entries.map(({ tag }) => ({
  name: tag + ".sql",
  sql: readFileSync(new URL(tag + ".sql", directory), "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean),
}));
const ledger = "d1_migrations";
const ledgerDDL = `CREATE TABLE IF NOT EXISTS ${ledger} (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;
const object = (db, name) => db.prepare("SELECT type,sql FROM sqlite_schema WHERE name=?").get(name);
const columns = (db, name) => db.prepare("SELECT * FROM pragma_table_xinfo(?) ORDER BY name").all(name);
const simplify = value => value?.replace(/\s+/g, " ").trim();
function tableShape(db, name) {
  return {
    columns: columns(db, name).map(c => [c.name, c.type.toLowerCase(), c.notnull, c.pk, c.hidden,
      ({ true: "1", false: "0" })[c.dflt_value] ?? c.dflt_value]),
    foreignKeys: db.prepare(`SELECT "table","from","to",on_update,on_delete,match
      FROM pragma_foreign_key_list(?) ORDER BY "from","to"`).all(name),
    indexes: db.prepare("SELECT name,origin,partial FROM pragma_index_list(?) ORDER BY name").all(name),
  };
}

// Only the pre-Phase-2 bootstrap history needs adoption. Simulate its missing
// DDL on a schema-only copy before issuing the first write to the binding.
function planLegacy(objects, applied) {
  const current = new DatabaseSync(":memory:");
  const reference = new DatabaseSync(":memory:");
  try {
    const plans = [];
    for (const obj of objects) current.exec(obj.sql);
    for (const migration of migrations.slice(0, 8)) {
      const missing = [];
      for (const sql of migration.sql) {
        reference.exec(sql);
        const create = /^CREATE (TABLE|TRIGGER) `?(\w+)`?/i.exec(sql);
        const add = /^ALTER TABLE `(\w+)` ADD `(\w+)`/i.exec(sql);
        if (!create && !add) throw new Error("Unrecognized legacy statement in " + migration.name);
        const present = create ? object(current, create[2]) : columns(current, add[1]).some(c => c.name === add[2]);
        if (!present) {
          if (applied.has(migration.name)) throw new Error("Missing schema from recorded migration " + migration.name);
          current.exec(sql);
          missing.push(sql);
        }
      }
      if (!applied.has(migration.name)) plans.push({ name: migration.name, sql: missing });
    }
    for (const { type, name, sql } of reference.prepare("SELECT * FROM sqlite_schema WHERE sql IS NOT NULL").all()) {
      const actual = object(current, name);
      const exact = type === "trigger" || /\b(CHECK|COLLATE|UNIQUE|STRICT|GENERATED|WITHOUT ROWID|DEFERRABLE|ON CONFLICT)\b/i.test(actual?.sql ?? "") || name === "workspace_owner";
      if (actual?.type !== type || (exact && simplify(actual.sql) !== simplify(sql)) ||
          (type === "table" && JSON.stringify(tableShape(current, name)) !== JSON.stringify(tableShape(reference, name)))) {
        throw new Error("Incompatible legacy schema for " + name + ". Review the restored database before migration.");
      }
    }
    return plans;
  } finally {
    current.close();
    reference.close();
  }
}

export async function migrate(db) {
  const { results: objects } = await db.prepare(`SELECT type,name,sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all();
  const applied = new Set(objects.some(o => o.name === ledger)
    ? (await db.prepare(`SELECT name FROM ${ledger} ORDER BY id`).all()).results.map(r => r.name) : []);
  const names = migrations.map(m => m.name);
  if ([...applied].some((name, index) => name !== names[index])) throw new Error("Unrecognized migration history; review the target database.");
  // Later forward migrations can supersede the original bootstrap schema.
  const legacyCount = names.indexOf("0007_founder_workspace.sql") + 1;
  const plans = applied.size <= legacyCount ? planLegacy(objects, applied) : [];
  plans.push(...migrations.slice(legacyCount).filter(m => !applied.has(m.name)));
  if (!plans.length) return [];
  await db.prepare(ledgerDDL).run();
  for (const { name, sql } of plans) {
    await db.batch([
      ...sql.map(statement => db.prepare(statement)),
      db.prepare(`INSERT INTO ${ledger} (name) VALUES (?)`).bind(name),
    ]);
  }
  return plans.map(p => p.name);
}

export function applicationTables() {
  const reference = new DatabaseSync(":memory:");
  try {
    for (const migration of migrations) for (const sql of migration.sql) reference.exec(sql);
    return reference.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'").all().map(r => r.name);
  } finally {
    reference.close();
  }
}
