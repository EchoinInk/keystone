# Phase 3 command safety and financial integrity

Verified locally on 19 November 2026. The application continues to use the founder’s dedicated D1 database and private R2 bucket. Migration 0008 adds one command receipt table. It contains no financial backfill.

## Commands and transaction boundaries

| Entry point | Application effect | Commit and retry behaviour |
| --- | --- | --- |
| `POST /api/data` | Create, update, duplicate, delete and bulk-delete across the 38 editable collections. Revisions, activity and assistant conversations are server-owned. | One D1 batch commits the request receipt, business changes, revision and activity for each affected record, and any affected task objective status. Creation history includes database defaults. Updates and deletions preserve the previous row. |
| Multipart `POST /api/data` | Create or replace a document with a file through the editor. | The request contains the JSON command and file together. The file registry, document, history and request receipt commit in one D1 batch. Existing document revocation triggers participate in that batch. |
| `POST /api/files` | Stage a file for an API client that will link it in a subsequent document command. | A successful upload returns a registered key. Downloads require a current document, registry entry and matching object ETag. The file digest, filename, size and type identify the request payload. The upload limit is 25 MiB because the Worker hashes the file in memory. |
| `POST /api/assistant` | Save an assistant conversation and its activity. | One batch commits the conversation, activity and replay reference. Financial questions use the complete ledger. For other questions, an optional provider call reserves its single attempt in D1 before dispatch. The provider timeout is 20 seconds. A concurrent request can receive 409 while the attempt is pending. After 25 seconds the same request can finish locally after interruption. |

All endpoints run behind the existing origin, founder admission and workspace-owner checks. The JSON contract checks the action, record selection, field allowlist, required fields, types, select options, dates and links. Bulk delete accepts 1–50 distinct IDs. Database checks inside the batch cover the selected row versions, relevant links and financial predicates. Deletes also check incoming application links that lack a physical foreign key.

Every write requires an `Idempotency-Key` header containing 1–128 letters, digits, underscores or hyphens. Generate a UUID per intended operation and retain it until acknowledgement. A matching key and payload return the committed record IDs or original assistant answer. Data mutations also return a fresh workspace snapshot. A different payload or endpoint with the same committed key returns HTTP 409. Keep command receipts with the workspace backup for the entire supported replay period.

The editor sends the row’s observed `expectedUpdatedAt` with edits and deletions. A stale version returns 409. Direct callers can submit a single-record version precondition. Commands without a client precondition still compare the version read during command preparation inside the write transaction. The browser stores the in-flight key in workspace-scoped session storage so an unreadable response or a reload in the same tab can be retried.

R2 and D1 have separate commit boundaries. A process interruption after the byte upload can leave an inaccessible object. A retry with the same file and request key reuses that object. For an abandoned upload, compare the object inventory with a paired D1 backup during maintenance. Preserve the bytes until outstanding retries and document ownership have been reviewed. Automatic deletion could race a later registration. The same paired restore requirement applies to the command receipts and file registry.

Browser drafts are scoped client storage. The offline migration, normalization, owner enrollment and template procedures remain administrative operations under the Phase 1 and 2 runbooks.

## Financial rules

- **Currency.** Invoice amounts, tax, receipts, expenses and revenue targets use NZD. The existing decimal-dollar columns remain authoritative. New monetary inputs require nonnegative values representable to whole cents. Receipt amounts must be positive. Sum each line in integer cents, then convert the result to dollars for display.
- **Invoice total.** Add the stored subtotal and tax amount. Tax is already a currency amount. For each non-void invoice, cash due is the greater of zero and total less linked receipts. A void invoice contributes zero. The existing convention includes drafts with positive balances. An open invoice is one with a positive balance.
- **Settlement.** The payment table is the receipt ledger. Sum each payment once on its invoice. A positive receipt total below gross gives Part paid. A positive total covering gross gives Paid. The invoice API exposes the saved workflow label as `recordedStatus` and the calculated display status as `status`. An unsupported historical Paid label with no receipts displays Unpaid and produces a finding. New manual settlement labels are rejected. The workflow label, original amount and dates remain available for review.
- **Write conflicts.** The committing transaction checks invoice-number uniqueness, one target per goal month and any nonblank payment reference on the same invoice using SQLite's case-insensitive trimmed comparison. Overpayments, receipts on void invoices, voiding an invoice with receipts and reducing invoice gross below receipts are rejected. Receipt edits exclude their own prior amount when testing the new allocation. Moving a receipt checks both affected historical settlement labels. Distinct unreferenced payments can legitimately have the same amount and date. Their request keys identify separate intents.
- **Cash reporting.** Monthly income is cash received in the stored payment-date month. The current reporting month follows the existing UTC clock. The chart uses six UTC calendar months anchored on the first of each month. A historical unallocated payment remains in collected cash and produces a finding. It settles no invoice. Monthly cash surplus is receipts less expenses recorded in the same month. A subscription or recurring flag creates no receipt.
- **Goals and pipeline.** Monthly progress uses collected cash divided by the selected goal, capped at 100 percent. A zero or absent target yields zero progress. Historical duplicate goals are reported and the dashboard selects the most recently updated row with ID as the tie-breaker. Open lead values and their probability-weighted forecast exclude won, lost, closed and unsuitable opportunities. Pipeline is reported separately from receipts.
- **Historical exceptions.** Reports retain overpayments, invalid amounts or dates, unallocated receipts, voids with receipts, conflicting settlement labels, repeated invoice numbers or references, and repeated goal months for review. Display totals are provisional where source data is disputed. The report includes original receipt values. A historical amount with excess decimals is rounded for the projection. An unquantifiable amount contributes zero to that projection. Reading a report never changes its inputs.

## Reconciliation report and migration proposal

The local Wrangler application database had **0 invoices, 0 payments, 0 expenses and 0 revenue goals**. Its reconciliation report had zero findings and NZ$0.00 outstanding. The source and the inspected copy both retained SHA-256 `9250208eb63575f07813258573ed945c96a2a75c4ca7f696b16ed7c1fe57b0c9`. Production balances and historical exceptions remain unverified.

Run the read-only report on a consistent restored SQLite backup, including any committed WAL contents. It emits counts, balances by invoice ID, source receipts, metrics and individual findings.

```sh
node scripts/reconcile-finance.mjs /path/to/restored-workspace.sqlite
```

1. Before a hosted cutover, take the paired D1/R2 backup under the Phase 1 procedure. Record the workspace, backup identifiers, migration history and reporting date. Rehearse migration 0008 on the restore and compare the invoice, payment, expense, goal and history rows before and after.
2. For each finding on that restore, record the original IDs and values, bank reference or original invoice, proposed correction, supporting evidence, and expected cash and balance deltas. Review duplicates individually. A repeated amount, an invoice label or a missing relationship alone cannot establish which receipt to change.
3. Obtain founder approval for the row-specific proposal. Rehearse approved corrections with version preconditions and stable request keys. Preserve before-images, original identifiers and the approval reference. Re-run the report and check affected invoices, monthly totals and unrelated rows. For a historical Paid label that blocks a correction, review its source and explicitly authorize its workflow status first.
4. Apply only a separately authorized correction set to the confirmed target, with writers paused when a set spans multiple commands. A failed comparison stops the cutover. Retain the report and backup and rehearse paired restoration before reopening writes.

The local report identified no rows requiring correction. This phase applied the schema migration only to disposable test databases.

## Verification evidence

| Exercise | Observed result |
| --- | --- |
| Full production build and test suite | `npm test` built and validated the packaged Worker and migrations. All 26 tests passed with zero skips, including the existing admission, document ownership, rendering and database lifecycle tests. |
| Contract and authorization | Form-shaped commands created all 38 editable collections. Unknown fields, malformed selections, invalid dates, invalid currency, forged history and unauthorized requests were rejected. Failed commands preserved business rows, history and receipts. |
| Concurrency and retries | Concurrent identical creates returned the same ID and committed one effect. A changed payload with the same key conflicted. Two editors using one version produced one success and one conflict. A lost snapshot response and an unreadable browser response both replayed successfully. |
| Interrupted operations | A failure on the third bulk-delete activity rolled back all three deletes and all history. Retry recorded every before-image once. Interrupted multipart upload left zero document, registry or audit rows and the staged bytes could not be downloaded. Provider interruption produced one external attempt in a mocked-provider test and one eventual conversation. |
| Financial reconciliation | A void NZ$115 invoice plus a NZ$100 invoice with a NZ$20 receipt yielded NZ$80 due in the API and assistant, including with 42 additional void invoices. Full settlement produced zero due. An audited one-cent receipt adjustment reopened one cent. A historical Paid discrepancy and an unallocated receipt were reported with their IDs and unchanged source rows. A disposable D1 migration also preserved every column of a historical invoice and receipt. |
| Real local workerd/D1 | Two retries of a NZ$0.20 receipt against NZ$0.30 committed once. Two independent NZ$0.10 final receipts then produced one success and one conflict. Deleting the linked invoice failed and left no delete revision. |
| Static checks | Strict TypeScript, ESLint with zero warnings, Drizzle snapshot validation and packaged-artifact validation passed. |

The browser submission helper was exercised with simulated storage and transport failure. The verification used local bindings and synthetic financial records. Hosted deployment, a live provider account and a founder-operated browser session were outside this run.
