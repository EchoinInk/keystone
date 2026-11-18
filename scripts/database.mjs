import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import { applicationTables, migrate, migrations } from "./migrations.mjs";
import { normalizeStatuses } from "./normalize-status.mjs";
import { seedFounderTemplate } from "./founder-template.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { local: { type: "boolean" }, remote: { type: "string" }, "persist-to": { type: "string" }, "founder-template": { type: "boolean" } },
});
const [command] = positionals;
const localId = "00000000-0000-4000-8000-000000000000";
if (positionals.length !== 1 || !["seed", "migrate", "normalize"].includes(command) || Boolean(values.local) === Boolean(values.remote)) {
  throw new Error("Specify migrate, normalize or seed and exactly one target: --local or --remote <database-uuid>.");
}
if (values.remote && (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(values.remote) || values.remote === localId || values["persist-to"])) {
  throw new Error("A remote migration requires the reviewed D1 UUID.");
}
if (command === "seed" && (!values.local || !values["founder-template"])) throw new Error("Seed requires --local --founder-template.");
if (command !== "seed" && values["founder-template"]) throw new Error("Run seed separately.");
const temp = await mkdtemp(join(tmpdir(), "keystone-d1-"));
try {
  const configPath = join(temp, "wrangler.json");
  await writeFile(configPath, JSON.stringify({
    name: "keystone-database-admin", compatibility_date: "2026-05-15",
    d1_databases: [{ binding: "DB", database_name: "site-creator-d1", database_id: values.remote ?? localId, remote: Boolean(values.remote) }],
  }));
  const proxy = await getPlatformProxy({ configPath, envFiles: [], remoteBindings: Boolean(values.remote),
    persist: values.local ? { path: resolve(values["persist-to"] ?? ".wrangler/state/v3") } : false });
  try {
    const db = proxy.env.DB;
    if (command === "migrate") {
      const names = await migrate(db);
      console.log(names.length ? names.join("\n") : "Database is current.");
    } else if (command === "normalize") {
      console.log(await normalizeStatuses(db));
    } else {
      const { results } = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
      if (JSON.stringify(results.map(r => r.name)) !== JSON.stringify(migrations.map(m => m.name))) throw new Error("Run the migration command before seeding.");
      console.log(await seedFounderTemplate(db, applicationTables()));
    }
  } finally {
    await proxy.dispose();
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
