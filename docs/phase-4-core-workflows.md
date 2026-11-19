# Phase 4 · Founder workflows and documents

## Work and handoffs

| Journey | Behaviour |
| --- | --- |
| Tasks | Create a task from Tasks, a weekly objective or a sprint briefing. The contextual forms carry the selected objective or sprint. Complete records the time and previous status. Reopen restores that status. Cancelled work drops out of progress calculations. Task filters include Backlog and Cancelled. |
| Sprints | One sprint can become active at a time. An existing workspace with multiple active sprints keeps its records and shows a prompt to select one. Presets and custom durations use inclusive calendar dates. Duplicating a sprint creates a planned copy. |
| Daily objectives | A standalone daily objective has its own status. Connecting an unassigned task assigns it to that sprint. Connected objectives follow the task’s status. Moving the task carries its daily objectives to the destination sprint. Clearing the sprint leaves them as standalone objectives in their original sprint at the task’s status. A task with several daily objectives counts once. |
| Weekly objectives and projects | The Tasks view also opens Founder goals for manually tracked goals. The founder edits a weekly objective’s outcome, week, phase, priority and due date. Linked tasks determine its status and progress. A project with no linked tasks displays its recorded progress. Historical Todo and Done labels and unambiguous objective-to-task links are interpreted on read. Explicit task reassignment resolves the link. |
| Leads | Capture starts at New and Open. Won, Lost and Not suitable close the opportunity. A won lead can create an Onboarding client or link to an existing client. The handoff copies contact details for a new client and preserves an existing client’s details. Existing lead-only proposals acquire the client in the same D1 transaction. Open the client from the lead, then open or add its proposals and projects. Project creation is an explicit founder action. |

The existing command receipt, revision and activity records cover each handoff. A retry returns the committed result. Version checks reject a stale editor. The browser retains the attempted edits and offers the latest version when the record changed. Conflicting sprint, project, client and lead associations fail before a partial handoff can commit.

## Document operations

Use the Documents tab in Knowledge Base, Clients, Projects or Content. Upload accepts one non-empty attachment up to 25 MiB. The document name defaults to the uploaded filename. The founder can rename it, change its client or project, or replace its bytes while keeping the document ID. A metadata edit leaves the R2 object intact.

Open document serves UTF-8 text and Markdown as plain text and supports PNG, JPEG, GIF and WebP images. The response uses a sandbox, disables sniffing and requests private, uncached delivery. All file types support authenticated download. The editor supports in-place changes to UTF-8 text and Markdown up to 1 MiB. Other attachments can be updated with Replace attachment.

Each open or download requires the admitted founder, the workspace owner binding, a live document, a registered key and the recorded R2 ETag. Historical revision data grants no file access. Editing text also checks the document version, both when loading the text and when committing the replacement.

## Interrupted operations and retention

Migration `0009_file_transfers.sql` adds the transfer table, lookup indexes and the final-reference cleanup trigger. It preserves existing business records, object keys and owner grants. Apply it through the existing migration procedure before serving this revision.

- A multipart document command reserves its workspace key before writing R2. D1 commits the registration, document, history and request receipt together. Retrying the same command and file after a lost response reuses the original result. Interrupted bytes stay private.
- An API upload staged through `POST /api/files` can be attached to a document for 24 hours. Incomplete reservations and unclaimed staged uploads become eligible for cleanup. Once an attempt has been retired, start a new upload with a new request key.
- Replacing or deleting the last document reference revokes access in the committing transaction. Document commands then process up to eight eligible cleanup jobs. A duplicate document keeps its shared bytes until its own reference is removed. A transient R2 failure leaves a durable retry. The workspace shows pending cleanup and provides a retry action.
- The admitted founder can run `POST /api/files?cleanup=1` with the usual same-origin request and a fresh idempotency key. Each call examines at most 32 objects in the founder’s prefix for late uploads to previously purged keys. Pass the returned `nextCursor` as `cursor` to continue. A nonzero `pending` count includes delayed retries. `moreDue` indicates immediately eligible work for a further batch. Recorded failures can retry after one minute. Cleanup runs on document commands and explicit requests.
- Physical cleanup applies to managed workspace keys with matching object versions. Unknown objects, unscoped legacy bytes and mismatched versions remain private for owner review. A paired backup must include D1, its receipts and transfer records, and the corresponding R2 bytes.

## Local verification

On 19 November 2026, `npm test` built and validated the Worker and packaged migrations. All 39 tests passed with zero skips. Strict TypeScript, ESLint with zero warnings, Drizzle snapshot validation and the installed dependency-tree check also passed.

| Evidence | Coverage |
| --- | --- |
| Chromium, packaged Worker, local D1 and R2 | Task creation from a weekly objective, sprint assignment, complete and reopen, cancellation, weekly outcome edit, and recovery from two editors using the same task version. Won-lead conversion, proposal association and project navigation survive reload. Document upload survives a lost acknowledgement, then opens, renames, edits, downloads and replaces. Cancelling deletion and attempting it as another user both preserve the document. Owner deletion revokes retrieval and removes the final managed bytes. |
| Worker integration and failure injection | Linked and standalone objectives, copies, legacy statuses and links, task moves between sprints, invalid assignments, duplicate client handoffs, stale edits and transaction rollback. File cases include shared references, expired staging, malformed multipart, changed ETags, late uploads and a failed physical delete followed by retry. |
| Local workerd boundaries | Concurrent active-sprint and task assignments, competing conversions and a 25 MiB file retrieved byte-for-byte. A replacement one byte over the limit is rejected. |
| Paired restore | A disposable SQLite backup and matching fixture object inventory restored the document ID, SHA-256, owner gate and original upload receipt. A mismatched restore returned 404. |

After installing the locked dependencies, install the pinned Chromium headless shell and run the suite from the repository root.

```sh
./node_modules/.bin/playwright-core install chromium --only-shell
npm test
npm run typecheck
npm run lint
./node_modules/.bin/drizzle-kit check
```

The browser used synthetic sessions through a local dispatcher. Hosted founder sign-in, hosted D1/R2 migration and deployment require a separate cutover.
