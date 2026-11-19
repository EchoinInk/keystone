# Keystone Phase 8 — standalone application distribution

**Architecture proposal · 19 November 2026 · Awaiting approval**

Distribute Keystone as a connected **Tauri 2** application. Bundle the React workspace on the device and use the existing backend for records, documents and coaching. Keep the browser as a supported delivery path. Qualify Apple Silicon macOS first, Windows x64 second and Android arm64 third. Safari and Home Screen access are the proposed iPhone and iPad channels.

## Stage A — architecture decision

Keystone’s React and TypeScript workspace already provides its navigation, editors, styles and accessibility behaviours. Its web entry uses Vinext and Vite with server rendering on a Cloudflare Worker. The backend handles persistence in D1 and document storage in R2. A small static entry can mount the shared workspace in an installed app, with packaged fonts and images and an adapter for service requests. [Workspace](../app/page.tsx) · [Web layout](../app/layout.tsx) · [Build configuration](../vite.config.ts)

| Application model | Founder experience | Decision |
| --- | --- | --- |
| Connected standalone | The installed window opens offline. Loading a workspace, saving a change, opening a remote document and using coaching require a connection. Unsent drafts can be recovered after sign-in. | **Preferred.** Provides direct installation while keeping one authoritative workspace across devices. |
| Limited offline operation | Selected records could remain readable or editable between connections. | Revisit for a specific founder workflow. Define data lifetime, stale-read behaviour, retry rules and conflict resolution for that workflow. |
| Self-contained local application | A device could own the workspace and its attachments and run rules-based operations offline. | A separate product decision. Requires local persistence, migrations, backup and restore. Multi-device use adds synchronization. |

| Runtime | Reuse and capability | Operating cost and fit |
| --- | --- | --- |
| Tauri 2 | Shares the React UI across desktop and Android. A Rust core exposes specific OS functions through a scoped bridge. | System WebViews limit what the installer needs to ship. Qualify WKWebView, WebView2 and Android WebView on the actual targets. [Tauri frontend requirements](https://v2.tauri.app/start/frontend/) · [WebView support](https://v2.tauri.app/reference/webview-versions/) |
| Electron | Shares React on desktop and supplies its own Chromium and Node runtime. | Consider if a required desktop feature depends on Node or a fixed Chromium version. The team would ship and patch that runtime and maintain a mobile shell separately. [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model) |
| Capacitor | Runs the static UI on Android and iOS with native plugins. | A mobile fallback if device testing identifies a required capability better served by a Capacitor plugin. It adds another shell alongside desktop. [Capacitor documentation](https://capacitorjs.com/docs) |
| Platform-native | Swift, C# and Kotlin clients can use the full platform UI and accessibility APIs. They can share Keystone’s service contract. | Each interface and its regression suite would need a platform owner. Reconsider for a measured requirement that the shared UI cannot satisfy. |
| Browser | Serves the existing workspace through a URL, including on phones and tablets. | One web delivery channel and browser QA. Use it as the comparison point for startup, memory, file handling and accessibility. |

## Stage B — implementation proposal

### Shared code, sessions and storage

Use one workspace component from the existing web entry and a new static renderer entry. Share forms, validation, navigation, styling and domain rules. Give the renderer a typed interface for loading records, submitting commands, working with documents and requesting coaching. The browser implementation uses web requests. The installed implementation also supplies OS file selection, explicit save and external-link handling. Both clients must preserve record-version checks, safe retries and per-request coaching consent.

Use the system browser for native sign-in with authorization code and PKCE. Register the callback for each target and verify that browser and installed sessions resolve to the same authorized workspace. Hold short-lived access tokens in native memory. Keep refresh credentials in macOS Keychain, user-scoped Windows protected storage or Android app-private storage encrypted with a Keystore-backed key. Provide session revocation and sign-out cleanup. [OAuth for native apps](https://www.rfc-editor.org/rfc/rfc8252.html) · [OAuth security best practice](https://www.rfc-editor.org/rfc/rfc9700.html)

Store recoverable drafts encrypted and scoped to the signed-in user. After an interrupted save, reload the record and use the same command identifier for a retry. Show a change as saved when the service acknowledges it. Keep offline launch and draft recovery within the first release’s defined scope.

### Packaging and distribution

| Target | Package and signing | Update and acceptance |
| --- | --- | --- |
| **macOS Apple Silicon** | Build the arm64 app with Xcode and Rust. Use a stable bundle ID, Developer ID Application signing, hardened runtime and timestamping. Notarize and staple the app used for updates, then sign, notarize and staple the final `.dmg`. | Distribute over HTTPS and verify the separate Tauri updater signature. Test a downloaded DMG on a clean Mac, Gatekeeper, installation into Applications, VoiceOver, file handling and upgrade. [Apple Developer ID](https://developer.apple.com/developer-id/) · [Notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) |
| **Windows x64** | Build a per-user NSIS `.exe` with MSVC and the Windows SDK. Detect WebView2 and provide the Evergreen bootstrapper when needed. Authenticode-sign and timestamp the executable and installer. Reserve MSI for a managed deployment that needs it. | Verify the publisher and updater signature. Test setup and upgrade as a standard user, runtime installation, Narrator, file dialogs and uninstall. Record the actual SmartScreen experience. [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/) · [Microsoft signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) |
| **Android arm64** | Build a release `.apk` with pinned JDK, Gradle, Android SDK/NDK and Rust toolchains. Protect the release key, register the package as applicable, and verify the signing certificate with `apksigner`. Offer the APK over HTTPS for user-confirmed installation subject to device policy. | Retain the application ID and compatible signing identity, and increase `versionCode`. Test installation from the intended source, in-place upgrade, Back, resume, TalkBack and the system file picker on a physical phone. Confirm developer verification rules for the intended region. [Direct APK distribution](https://developer.android.com/distribute/marketing-tools/alternative-distribution) · [Android signing](https://developer.android.com/studio/publish/app-signing) · [Developer verification](https://developer.android.com/developer-verification) |
| **Browser, iPhone and iPad** | Use the web release channel. Qualify Safari and Add to Home Screen independently on iPhone and iPad. | Updates arrive through web deployment. Exercise session return, VoiceOver, orientation, keyboard and attachment handling on physical devices. [Safari Home Screen apps](https://support.apple.com/en-gb/guide/iphone/iphea86e5236/27/ios/27) |

If Keystone later needs a native iOS feature, use TestFlight for a time-limited beta or Ad Hoc provisioning for registered devices. For ongoing distribution, assess the public or unlisted App Store and Custom Apps for named organizations. Enterprise distribution applies to eligible internal employee use. Regional alternatives have distinct requirements. Apple documents eligible marketplaces in the EU, Japan and Brazil, and authorized direct web distribution in the EU. Select the channel against the actual audience and territory before building the native target. [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) · [Ad Hoc provisioning](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/) · [Apple distribution methods](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods/) · [Regional availability](https://support.apple.com/en-us/118110)

### Build, test and release

1. **Approve the architecture and first target.** For the Mac feasibility milestone, demonstrate an offline shell launch and real browser and native sign-in to the same test workspace. Demonstrate expiry, revocation and isolation from another test identity.
2. **Build the active target.** Run the existing web checks and add the native job on macOS, Windows or an Android-capable Linux runner as its turn arrives. Pin dependencies and toolchains. Build candidates from a reviewed revision. Use a protected signing job and retain the artifact hash, dependency inventory, tool versions and verification result. [Engineering CI](../.github/workflows/engineering.yml)
3. **Pass the target’s test gate.** Test the intended minimum and current OS on a clean installation. Exercise task and document workflows, interrupted saves, relaunch, assistive technology, signed upgrade, rejection of an invalid update and uninstall. Compare cold launch, peak memory and document transfer time with the browser using the same fixture.
4. **Approve the target’s release.** Verify the bytes and publisher from the download channel. Record the supported OS and architecture, founder acceptance, release notes and support owner. Publish immutable artifacts before promoting desktop update metadata. Keep updater and platform signing credentials separate. Rehearse withdrawing a release and issuing a compatible corrected build at a higher version. Each platform has its own testing and release decision before work starts on the next. [Tauri updater](https://v2.tauri.app/plugin/updater/)

### Engineering estimate

Estimates assume one engineer familiar with Keystone, part-time release QA, access to test devices and a supported identity provider.

| Work package | Complexity | Incremental engineer-days | Main dependency |
| --- | --- | ---: | --- |
| Mac sign-in and connectivity proof | High uncertainty | 3–5 | Test workspace, identity provider and registered callback |
| Shared renderer, service transport, protected drafts and contract tests | High | 12–20 | Accepted feasibility result |
| Apple Silicon Mac candidate | Medium–high | 6–10 | Apple membership, signing credentials, runner and Mac |
| Windows x64 candidate | Medium | 5–9 | Mac gate decision, Windows signer, runner and test machine |
| Android arm64 candidate | Medium–high | 8–14 | Windows gate decision, package registration, signing key and phone |
| iPhone/iPad browser qualification | Low–medium | 2–4 | iPhone, iPad and test session |
| Optional native iOS pilot | Medium–high | 8–15 | Separate approval, eligible channel, Apple credentials and devices |

The first Mac candidate is estimated at **21–35 engineer-days** including shared work. The three proposed binaries total **34–58 engineer-days**. iOS browser qualification and external enrollment or review lead times are additional. Architecture approval authorizes the first feasibility milestone. Signing and release to users require the target’s later release decision.
