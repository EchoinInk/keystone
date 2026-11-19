# Phase 5 · User experience and accessibility

## Navigation and interaction

At 390 × 844, the previous 38-pixel navigation buttons overlapped. The centre of Mission Control activated Freelance Launch, global search was 89 pixels wide, and the record editor opened with focus behind it. Typing a task name and immediately pressing Escape reopened an empty draft.

At widths up to 1100 CSS pixels, Menu now opens a labelled list of the same 12 destinations. A selection moves focus to the page heading. Escape returns focus to Menu. Each destination has a native fragment link and supports reload, Back and Forward. The desktop rail, Ei artwork, serif headings and violet palette are retained. Search spans the phone header. Record rows reflow on narrow screens, keeping status, related records and actions within reach.

Mission Control’s **Workspace records** disclosure opens its existing record collections, including Daily journal, KPIs and Team members. Global search opens editable records and saved conversations. Activity entries whose source has gone remain readable as history.

Editors, transcripts and the assistant use named native dialogs. Opening moves focus inside, Tab and Shift-Tab stay inside, and closing returns focus to the invoker or the page heading if the invoker has gone. Task actions support Escape. A skip link, visible keyboard focus, associated field hints and errors, announced save feedback and reduced-motion styles apply throughout the workspace.

## Forms and drafts

- Creation forms initialise their displayed values before submission. Required fields are marked, identifying fields come first, and Save and ⌘/Ctrl + Enter use the same validation. The first invalid control receives focus. Amounts, percentages, required relations, dates and whitespace-only required text receive field-level feedback. Server-side checks remain authoritative for record links, balances and version conflicts.
- A field change writes its draft immediately. New drafts retain their displayed defaults. Edit drafts retain the changed fields and the original record version. Reopening after another edit requires reviewing the changes against the latest record. Saving successfully or explicitly discarding removes the matching draft.
- Drafts use the existing server-derived identifier for the admitted founder and site, plus the collection and record or originating parent. Previously scoped new-record drafts can be recovered, including contextual drafts created with older date or priority suggestions. Unscoped drafts have no verified owner and stay excluded from restoration.
- Browser commands carry the workspace identifier the form was opened under. The Worker checks it against the current authenticated scope before executing the command. Switching the admitted workspace with a form still open leaves the original draft with its founder.
- When another tab has changed the stored draft, the editor keeps the local changes on screen and warns before closing. It also warns if browser storage fails. Attachment selections and unsaved document text live in the open editor. Closing or reloading with those changes pending prompts for confirmation. Document metadata follows the ordinary draft rules.

## Local verification

On 19 November 2026, `npm test` built and validated the Worker and passed all 48 tests. The separate WebKit run passed all 13 browser tests. Both runs had zero skips. TypeScript, ESLint, the installed dependency tree and Drizzle snapshot validation also passed. axe-core reported zero violations in the scanned states.

The tests use the packaged Worker, disposable D1 and private R2, and synthetic founder sessions. Chromium uses the canonical HTTPS origin with a local dispatcher. WebKit sends its native HTTP requests, including multipart files, through a loopback adapter to the same dispatcher.

| Exercise | Coverage |
| --- | --- |
| Navigation and reflow | All 12 destinations at 1440 × 900, 820 × 1180, 390 × 844, 844 × 390, 720 × 450 and 320 × 640 CSS pixels. Checks cover touch activation, the active destination, heading focus, document width, history and reload. The 720-pixel case exercises the layout width of a 1440-pixel desktop at 200% zoom. |
| Essential workflows | Desktop and phone browser tests create and complete sprint and objective work, reopen and cancel tasks, resolve a stale edit, convert a lead, open its client and project, create an invoice and record a payment. Document tests recover an interrupted upload, open, rename, edit, download, replace and delete files. |
| Keyboard and feedback | Skip to content, navigate the menu, search and open a result, open task actions, cycle dialog focus in both directions, restore focus, correct an invalid field, and submit by shortcut. Tests inspect a visible focus outline and measure a representative form label against its rendered background. |
| Draft recovery | Immediate close, reload, separate objectives, two tabs, two admitted workspaces in the same browser, a denied session, an open form after an owner switch, a stale record, legacy scoped data, unavailable storage and attachment dismissal. |
| Automated accessibility | axe-core scans each populated primary screen at desktop and phone width, plus expanded navigation, invalid forms and the assistant. The tests also check reduced-motion computed styles and touch target dimensions. |
| Visual inspection | Rendered Chromium desktop and phone Mission Control, the expanded phone menu, a task row with its actions and the record editor. |

The 320-pixel reflow check and the 4.5:1 sampled normal-text contrast check use the W3C criteria. A rendered contrast sample covers that text and background pairing. [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [Contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

Run from the repository root with the locked dependencies and the Chromium headless shell installed. The separate WebKit run requires the Playwright WebKit binary. The macOS WebKit keyboard tests use Option-Tab for full traversal with the default preference. [Apple keyboard navigation](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac)

```sh
npm run typecheck
npm run lint
npm test
KEYSTONE_TEST_BROWSER=webkit node --test tests/accessibility-browser.test.mjs tests/founder-browser.test.mjs
```

## Remaining verification

Physical iPhone and Android touch, software keyboards, OS text enlargement and spoken VoiceOver and TalkBack feedback remain unverified. Layout-width emulation covers reflow. Actual browser zoom controls and contrast across every gradient, record state and native picker require manual inspection. The installed Firefox Nightly exited before opening either temporary profile, so Firefox remains unverified. Hosted sign-in and deployment were outside this local phase.
