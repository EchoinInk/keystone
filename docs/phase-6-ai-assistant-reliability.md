# Phase 6 · AI assistant reliability

Keystone saves a rules-based suggestion for each question. The founder can use it immediately or review a request for optional OpenAI coaching. Financial questions use the existing workspace ledger. Suggestions remain advisory. The founder makes business changes through the existing workspace controls.

## Consent and authorization

The assistant uses the existing private Sites founder admission and the dedicated database registered to that founder. The Worker checks the caller, origin, database owner and any expected workspace on each request, including transcript reads and approvals. Assistant commands accept a question, a preview request, or a decision about an existing conversation. The server selects the context and controls the resulting status.

**Review OpenAI request** saves the local answer and freezes the proposed input. The founder sees the exact question and record fields before choosing **Approve and send to OpenAI** or **Decline and keep local**. Approval applies to that conversation once. Closing the drawer leaves the request pending. A recorded approval interrupted before dispatch can be continued or withdrawn from the transcript.

The local coach examines up to 40 recent rows per relevant collection. Its financial calculations use the full ledger. A provider preview contains up to five records per relevant collection, with an allowlist of fields and up to 100 characters per text field. Knowledge Base questions can include a 300-character excerpt per selected knowledge record. Explicit contact fields, note bodies, attachment keys, ledger entries and earlier transcripts stay local. The founder can inspect free text in the preview, including the full question.

## Saved state and retries

| Saved state | What the founder can rely on |
| --- | --- |
| Rules-based suggestion | The local answer and its linked Activity event were saved together. |
| Awaiting approval | The exact proposed input is available for review. |
| Declined | The pending input has been discarded. The local answer is available. |
| Approved | Keystone recorded consent. The request is eligible for one dispatch. |
| In progress | One request has claimed the dispatch in D1. A second tab or a replay can check its status. |
| Completed | Keystone validated and saved the OpenAI suggestion. Completion refers to the provider request. |
| Failed | The transcript identifies the failure and retains the local suggestion. An interrupted request with an uncertain outcome is labelled accordingly. |
| Historical suggestion | The original question, answer and ID are preserved. The source is labelled unrecorded. |

The original command key protects creation of the transcript and Activity event. Approval records its own receipt. A conditional D1 update claims the provider call across all keys for that conversation and clears the stored preview. The Worker allows 20 dispatches per rolling hour per workspace, with a 20-second provider deadline. After 30 seconds a still-running attempt reads as interrupted. Replaying its approval records that outcome without sending the question again.

OpenAI receives the reviewed input with response storage disabled and an empty tool list. Keystone requires a completed assistant message containing the requested suggestion schema. It checks the reply type, text, length and fields before saving it. Refusals, incomplete answers, unexpected tool calls, malformed content and transport failures have explicit fallback outcomes. [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create) · [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Saved conversations appear in the assistant, the workspace record collections, global search and Activity. Opening one reads its exact ID from the admitted database. General workspace snapshots omit the provider preview. Migration `0010_assistant_consent` adds the state fields and dispatch-time index to the existing transcript table. Historical Activity entries with missing targets retain their original references.

## Verification

| Requirement | Local evidence |
| --- | --- |
| Authorized access and denial | Separate founder databases, signed-out and expired sessions, a different founder, stale workspace headers, forged command fields, unknown actions and read-only history. |
| Consent | A configured provider receives zero calls for a local question, a preview or a decline. Editing records after preview leaves the approved input byte-for-byte identical to what the founder reviewed. |
| History | The saved transcript, original command receipt, assistant selector and Activity link resolve the same ID across reloads. Historical questions and answers retain their IDs and text. |
| Provider failure | Fixtures cover missing credentials, service errors, rate limits, interrupted and stalled response bodies, refusal, incomplete output, invalid JSON, unexpected tool calls and oversized replies. |
| Retry safety | Injected D1 failures interrupt transcript creation, dispatch and result persistence. Simultaneous approvals with matching and different keys, plus dropped browser acknowledgements, keep one transcript, one Activity event and at most one provider dispatch per question. |
| Displayed outcome | Browser tests exercise local advice, pending approval, decline, completion and failure. They check recovery after a lost acknowledgement, the exact transcript on the timeline and expiry before approval. |

Run `npm test` for the packaged Worker and the full regression suite. With a fresh build, `node --test tests/assistant-reliability.test.mjs tests/assistant-browser.test.mjs` runs the assistant-specific integration and browser checks. The provider is simulated. Browser tests run against workerd with disposable D1 and synthetic founder sessions.

The full suite passed 55 tests with zero skips. TypeScript, ESLint, Drizzle snapshot checks and build artifact validation passed. The assistant browser journey passed in Chromium and WebKit. Firefox Nightly exited at profile startup on both attempts. Live OpenAI, hosted sign-in and production migration or deployment remain unverified.
