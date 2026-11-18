# Keystone Phase 2 engineering stability

19 November 2026, verified locally on macOS arm64 against the founder-isolation baseline at `60baa0f`. Phase 2 covers the toolchain, builds and database initialization. Production deployment and hosted CI execution are pending.

## Release engineering

| Area | Change |
| --- | --- |
| Installation | The locked installer verifies Node 22.23.4 and npm 10.9.9 before changing dependencies. Updated the manifest and lock together, including Next 16.4.6, the React/DOM/RSC 19.3.1 family, Vinext 1.4.6, Vite 8.3.8 and matching Cloudflare tooling. Miniflare and Worker types are direct development dependencies. The installer uses npm integrity checks, serialized installs and optional matching Sites cache seeds. Bash and Python provide portable locking and process timeouts on Linux and macOS. |
| Type checking | The Phase 1 checkout already passed a fresh strict check. The new typecheck script always bypasses incremental state, covers the Worker, application, build plugin, configs and examples, and excludes tool output. The request context now uses Cloudflare’s D1 binding type. |
| Lint | Task status controls derive the displayed value from the saved task plus an in-flight edit. Duplicate/delete operations retain their busy state. Removed an unused sprint calculation. CI enforces zero warnings and lints the authored build plugin. |
| Production packaging | Pinned the Worker compatibility date. Included portable font-cache manifests for the existing Geist font binaries. The artifact validator compares the packaged hosting manifest and complete migration tree to source. Node fixture imports supply the optional Workers tracing namespace. A separate workerd integration loads the real Worker with D1 and R2. Local production preview uses Wrangler with the built config. |
| CI | Push and pull-request jobs install the frozen lockfile, check the dependency tree, fail on high/critical advisories, run strict TypeScript and ESLint, check the Drizzle metadata, run the full built-Worker suite and compare two release builds. The workflow has read-only repository permissions and a twenty-minute limit. |

For release reproduction, supply `KEYSTONE_BUILD_REVISION` as the full source revision and inject `KEYSTONE_BUILD_KEY` as a private 32-byte hex secret through the release environment. Reuse the same inputs for a rebuild of that revision. The wrapper derives separate Vinext preview, revalidation, prerender and RSC inputs. An explicitly supplied `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is also a build input. Keep release keys in the operator’s secret store. One-off builds without the release inputs use Vinext’s fresh credentials. The build comparison uses an ephemeral secret. Its scope is the same sources, toolchain, platform, checkout path and environment.

## Database operations

The former bootstrap ran on admitted data GET/POST and assistant POST requests. It created tables, added columns, normalized every task and sprint objective, and could populate founder records or recreate an internal project and sprint. The Worker now performs business reads and writes only. It writes canonical task statuses when creating tasks and handles legacy sprint-objective spellings at the write boundary.

1. **Local D1 or an explicitly administered standalone D1.** Run the schema migrator before serving traffic. It reads the original Drizzle files in journal order, reconciles historical DDL on an in-memory schema copy and refuses incompatible tables, missing recorded changes or unknown migration histories. Compatible existing tables and columns can be adopted, including partially applied historical files. Each pending migration and its Wrangler-compatible `d1_migrations` entry commit in one D1 batch. After an interruption, rerun against the same target. Concurrent runners may receive a conflict and retry.
2. **Hosted Sites.** Sites owns hosted schema application during publish. The build ships the existing schema-only migrations 0000–0007, snapshots and journal byte-for-byte. For an existing Site, establish its actual migration state and rehearse with restored data before cutover. A standalone Wrangler ledger does not establish the hosted platform’s migration state. An untracked or inconsistent hosted baseline requires reconciliation with the hosting operator before publication.
3. **Status backfill.** Run the separate normalization command after schema initialization and before admitting traffic to the new version. It translates historical task/objective statuses, supplies missing completion times from the original update timestamp and records completion in `system_meta` in a single atomic batch. Existing completion timestamps and unrelated fields are preserved. Repeated calls return the recorded result. Keep the existing Phase 1 owner enrollment, attachment review and paired backup/restore procedure in the cutover. [Founder cutover procedure](phase-1-workspace-isolation.md#legacy-data-and-cutover)
4. **Founder template.** Installation requires both the local target and the explicit founder-template flag. It accepts an empty application database, including one with the normalization marker or an enrolled owner. It writes the existing authored template, task links and version markers atomically. A completed install returns without touching later edits. Populated or partially seeded legacy databases require individual review. Seeding grants no workspace access.

For a fresh local workspace, the first two commands initialize the database. The third installs the optional founder template.

```sh
npm run db:migrate -- --local
npm run db:normalize -- --local
npm run db:seed -- --local --founder-template
```

For an isolated rehearsal, append the same `--persist-to <temporary-directory>` to each command. The default local proxy persistence root is `.wrangler/state/v3`. For authorized standalone administration the schema and normalization commands accept `--remote <reviewed-D1-UUID>` and use authenticated Wrangler remote bindings. The local placeholder UUID is rejected as a remote target. For Sites, use the hosted schema process above and run normalization only against the confirmed binding.

## Verification record

| Command or exercise | Result |
| --- | --- |
| `npm run install:ci` and `npm ls --all` | Clean install passed, 508 packages on macOS arm64. Dependency tree exited zero. npm lists platform-specific bundled optional packages as extraneous on this host. |
| `npm audit --audit-level=high` | Passed. The initial audit reported two critical and seventeen high entries. The final audit reports zero critical, zero high and eight moderate entries. |
| `npm run typecheck`, `npm run lint`, `./node_modules/.bin/drizzle-kit check` | Passed with zero TypeScript errors, ESLint errors or warnings, and valid snapshot history. |
| `npm run build`, `npm run validate:artifact`, `npm test` | Production build and artifact checks passed. All 15 tests passed with zero skips. The suite covers founder authorization, documents, assistant, rendered HTML, real workerd bindings, schema adoption and maintenance. |
| `python3 scripts/check-reproducible-build.py` | In a clean source copy with a fresh locked install, all 204 packaged paths and SHA-256 digests matched. The second build started with no dist directory. |
| `npm start` | Served the built Worker from a disposable checkout. The founder guard rejected the loopback request to /api/data with HTTP 403. |
| Historical adoption | Replayed the actual bootstrap from `60baa0f` on disposable D1, added a synthetic historical note and adopted the schema. All original rows across 42 tables matched before and after schema migration. The fixture contained no production records. |
| Recovery and request behavior | Tests verify incompatible schema rejection before schema writes, migration rollback and retry, backfill rollback and retry, and atomic seed rollback and preservation of later edits. Two admitted GETs issued only SELECTs. Traced task and assistant writes left a legacy status sentinel and founder opt-in marker alone. |
| Operator commands | On a fresh persisted disposable D1, all eight migration files applied, normalization completed and the template installed. Repeating all three returned current/already normalized/already installed. Remote seed, missing seed opt-in and remote placeholder arguments were rejected during argument validation. |

## Outstanding items

The eight moderate npm entries come from two chains. Drizzle Kit’s generator loader depends on an older esbuild development server. Vinext’s Open Graph image dependency reaches fflate through Satori. npm proposes breaking downgrades for both. They remain recorded for upstream-compatible updates. Vinext and Rolldown also report sourcemap and chunking warnings during successful builds. The packaged Worker passed the integration tests.

Verification used local macOS and disposable bindings. The GitHub-hosted Linux job, authenticated remote commands, a real founder backup and a hosted deployment were outside this run. Phase 1 production cutover requirements still apply.
