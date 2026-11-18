# Keystone Phase 1 — security and workspace isolation

Baseline `d503edbb31adc739fe5d3a3989af2582a36c09be`. Implementation and verification are local. Cloudflare inspection used read-only control-plane and aggregate storage queries on 19 November 2026 NZ time.

## Access model and ingress inventory

This build implements the roadmap’s private single-founder pilot. One verified, site-scoped ChatGPT subject owns a dedicated D1 database and private R2 bucket. Sites dispatch authenticates the session, enforces its expiry, strips inbound identity assertions and supplies the authenticated subject. Its exclusive control of ingress is a deployment prerequisite. A hostname and an ordinary HTTP header alone provide no proof of the sender on a publicly invocable origin.

The application checks the exact HTTPS Site origin, the dispatch-supplied subject against the server-only `FOUNDER_USER_ID`, and the same subject and Site origin in D1’s singleton `workspace_owner`. Admission happens before bootstrap, request parsing and provider calls. The binding set for that request lives in async-local storage. Email, names, client and team records, query strings, draft keys and form fields grant no authority. Browser writes require the canonical Origin.

| Entry or operation | Effective policy in this build |
| --- | --- |
| Worker fetch, HTML, RSC, static assets and image optimization | Same founder guard before dispatch. Responses use private, no-store caching. A signed-out HTML visitor gets a top-level Sites sign-in link. |
| Sites sign-in, sign-out and callback | Managed by Sites before application dispatch. Session expiry and header sanitization must be verified on the actual gateway. |
| Direct Workers URL, alternate hosts, previews, plain HTTP | The application rejects alternate request origins. Generated configuration disables Worker and preview URLs and sends asset requests to the Worker first. [Cloudflare asset routing](https://developers.cloudflare.com/workers/static-assets/binding/) |
| Framework handlers called outside this Worker | No authenticated binding context. The database accessor fails closed. Development and example code have no independent grant. The example notes route is outside the deployed app route tree. |
| GET /api/data | Reads the admitted database’s 41 collections, including histories and calculated metrics. |
| POST /api/data | Create, update, duplicate, delete and bulk delete use that same database. Changed record links resolve inside it. Missing targets and mixed bulk selections are rejected. Activity, revisions, transcripts, ownership and storage registries have no generic write path. |
| POST /api/files | Issues a random key in the authenticated workspace namespace, stores the bytes, then registers metadata from the upload and its R2 ETag in that database. |
| GET or HEAD /api/files | A current document ID or legacy key must join to an approved object in the owner’s database. The fetched object must match its recorded ETag. Download is an attachment with sniffing disabled. |
| Document edit, duplicate, replace, delete and bulk delete | A changed key must be registered. Database triggers enforce this at write time and revoke the registration when the final live reference is replaced or removed. Earlier revision snapshots confer no download permission. |
| POST /api/assistant | Selects allowed context tables in the admitted database, invokes the configured provider only after authorization, and writes the transcript and its linked activity in one database batch. |
| Bootstrap, task status propagation and histories | Synchronous to the authorized request and use its bindings. Initialization is isolated per binding. Founder-specific seeding requires existing founder seed provenance or an explicit operator opt-in. No scheduled, queue, RPC, webhook or application server-action entry was found. |

Browser drafts use a server-derived workspace namespace and the editor opens after an authorized workspace response. Legacy unscoped browser drafts are left in place and are excluded from automatic loading.

## Founder data review

The Cloudflare Worker named `echo-in-ink-founder-os` supplied the binding identifiers for this review. Its D1 had **177 application records across 41 collections**, plus three system metadata rows. These included 17 tasks, 20 activity entries, 18 revisions and two assistant conversations. The studio project still linked to the internal client. Declared foreign-key checks found zero violations, and all nonempty task objective links resolved.

The database schema contained no historical owner, workspace, tenant or user ID columns. Founder-specific records establish context. They cannot establish the signed-in founder’s identity or independently prove sole ownership. Two assistant activity entries referenced absent conversation IDs. Preserve them for owner review. Any repair needs independent evidence of the correspondence.

D1 contained zero documents and the bound R2 bucket listed zero objects. The R2 public endpoint was disabled, with zero custom domains. At inspection time the standalone Worker had its Worker and preview URLs enabled. Endpoint availability to anonymous users was not tested. The Sites connector could not resolve the project ID recorded in this checkout. The standalone binding audit therefore supplies no evidence about a separate Sites deployment or its session policy.

## Legacy data and cutover

1. Identify the intended Sites project and its canonical dispatched URL, verify the setter and stripping of identity headers, current session/expiry behavior and the founder’s stable **site-scoped** subject through a trusted administrative channel. Record the D1 ID and R2 bucket bound to that deployment. Confirm that the founder recognizes the entire historical dataset. Defer enrollment if any records may belong to someone else.
2. Quiesce legacy writers for the final snapshot. Export the dedicated D1 and the matching R2 inventory and bytes to restricted backup storage. Record database identity, row counts, attachment IDs, keys, sizes, raw R2 ETags and independent SHA-256 file digests. Restore both to an isolated destination and check matching counts, links and file digests. A snapshot of local development data is only a rehearsal.
3. Run `python3 scripts/rehearse-founder-ownership.py /path/to/standalone-backup.sqlite` on a consistent offline SQLite restore. It opens the source read-only, executes migration 0007 and a synthetic owner insertion in memory, then compares counts and full-row digests for each original table. Investigate integrity failures or missing links before admission.
4. On the isolated restore, apply only the missing migration. A request-bootstrapped baseline may already contain the earlier schema. Compare it with the baseline before applying 0007. The migration adds two empty tables and document guards. Existing record IDs and object keys are preserved.
5. For each legacy attachment, have the owner verify its exact D1 reference, bucket provenance, length and backup SHA-256. Confirm that these bytes restore with the recorded raw ETag. Register only approved objects in the private registry. The parameterized statement below takes a verified raw ETag, the independently reviewed document ID, exact key and byte length. Require one inserted row. For shared keys, review every live reference to that key before registration. Leave ambiguous, changed or unreferenced objects inaccessible. No registrations were indicated by the inspected live inventory.

   ```sql
   INSERT INTO workspace_files (object_key, etag, name, content_type, size)
   SELECT object_key, ?, name, content_type, size FROM documents
   WHERE id = ? AND object_key = ? AND size = ?;
   ```

6. Only after ownership and restore review, register the verified Site origin and subject through an administrator’s parameterized D1 statement. A duplicate slot must fail and be investigated. Set the matching private Worker variable `FOUNDER_USER_ID`. There is no first-user enrollment or ownership-transfer endpoint.

   ```sql
   INSERT INTO workspace_owner (slot, site_origin, subject) VALUES (1, ?, ?);
   ```

7. Exercise the founder and a second identity on the isolated deployment, including signed-out and expired sessions, client-supplied identity headers, all API methods, upload/download/replacement/final deletion, private histories and assistant denial. Verify original IDs, relationships and approved attachment digests. Confirm that the dispatcher is the only caller with access to the protected Worker and that no other service or public bucket path can read those bindings. Retire or isolate the old standalone Worker, its previews and previous code accepting those bindings as part of the approved cutover.
8. Recheck the final snapshot and apply the rehearsed changes only to the approved target. If validation fails, disable admission and isolate the old ingress. Restore the paired backup behind the same private boundary. Reopening an older unguarded Worker would restore the original exposure.

Revocation removes application access to bytes immediately after the final document deletion or replacement commits. R2 retains detached bytes pending a separately approved retention and cleanup operation. A failed or abandoned upload can leave private orphan bytes. Never infer ownership from an orphan or bulk-register a bucket listing. The live database, owner grant, R2 objects and deployment settings were left untouched during implementation.

## Verification evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Unauthenticated requests rejected | Built Worker tests cover HTML, assets, optimizer, all five API methods, missing admission, direct hosts and cross-origin writes. Denied requests made zero D1, R2 and provider calls before identity admission. A local workerd dispatcher fixture also strips a supplied identity header from an expired synthetic session. |
| Workspace read/write/delete isolation | Two database bindings were exercised concurrently. Foreign IDs failed update, duplicate, delete and mixed bulk delete. The legitimate owner retained edit and deletion rights. A blank workspace received no founder templates. A misbound admission variable failed against the recorded database owner. |
| Permission-controlled documents | Fixture tests cover pending, foreign and unapproved keys, mismatched ETags, replacements, duplicates, final-reference revocation and exact legacy bytes. A separate workerd test exercised upload, metadata creation, download and revocation through local D1 and R2. |
| Ownership cannot be reassigned through requests | Reserved identity fields and generic access to owner/registry/system tables were rejected. The persisted founder subject remained unchanged. History mutations were denied for every generic action. |
| Founder records preserved | Offline migration of the local founder snapshot preserved full-row digests across 42 tables. An authorized read of an in-memory restoration returned all 134 original application IDs across 41 collections and the original project/client link. A second subject received 403. Live founder sign-in and reconciliation of the 177-record deployment remain cutover checks. |
| Scoped assistant and jobs | A fixture provider received context from the admitted binding. Denial made zero provider calls. The new activity referenced its own transcript in the same database. Source and artifact configuration showed no independent background consumers. |

Nine tests passed against the final local build, including eight authorization tests and the admitted-founder HTML smoke test. The test entry points are `npm test` for build and all tests, and `npm run test:authorization` after building. The workerd integration test needs a loopback listener. The verified build wrapper requires GNU timeout. On the inspected Mac the underlying Vinext build, artifact validation and strict TypeScript check ran separately. Repository lint retains the baseline task-status effect error and unused sprint variable.


## Files changed

| Area | Paths |
| --- | --- |
| Identity, Worker ingress and scoped database access | `app/chatgpt-auth.ts`, `worker/index.ts`, `db/runtime.ts`, `db/index.ts`, `vite.config.ts` |
| Protected workflows and browser | `app/api/data/route.ts`, `app/api/files/route.ts`, `app/api/assistant/route.ts`, `app/page.tsx`, `db/bootstrap.ts` |
| Persistence | `db/schema.ts`, `drizzle/0007_founder_workspace.sql`, `drizzle/meta/0007_snapshot.json`, `drizzle/meta/_journal.json` |
| Verification | `package.json`, `tests/authorization.test.mjs`, `tests/workerd-authorization.test.mjs`, `tests/fixtures/workspace.mjs`, `tests/rendered-html.test.mjs` |
| Remediation and handoff | `scripts/rehearse-founder-ownership.py`, `README.md`, `DEPLOYMENT-GUIDE.md`, `docs/phase-1-workspace-isolation.md` |
