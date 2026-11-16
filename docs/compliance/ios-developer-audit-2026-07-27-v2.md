# iOS Developer Documentation Audit — Re-run (v2)

- **Target**: `ios/NoMarkup` (repo `/Users/nuclearisotope/Projects/Personal/NoMarkup`; app + `NoMarkupWidget` extension + `NoMarkupTests` + `NoMarkupUITests`)
- **Date**: 2026-07-27 (re-run after remediation; prior report: `ios-developer-audit-2026-07-27.md`, remediation log: `ios-developer-audit-remediation-2026-07-27.md`)
- **Hub snapshot**: 2026-07-26 — https://developer.apple.com/ios/ (fresh)
- **Platform / stack**: Native SwiftUI, Swift 6.0, strict concurrency on all 4 targets, iOS 17.0 floor, iPhone+iPad, v1.0.0 (3), sole SPM dep `stripe-ios 24.25.0`. New since v1: widget extension (2 widgets + auction Live Activity), 5 App Intents, unit-test target, privacy manifest, String Catalog, APNs HTTP/2 provider in `services/notification`, associated domains + AASA.
- **Target SDK bar**: Xcode 26 / iOS 26 SDK floor; hub features iOS 27
- **Platform readiness**: **NOT READY** — but the gap has collapsed from 3 broad blocker FAILs to **2 narrow ones**, each an hours-level fix (see below). Independent of those, the SIWA-nonce RISK would hold the label at AT RISK.
- **Related**: `/app-store-compliance` (ASR policy) — re-run recommended after the ASC label + age rating are entered

## Goal (audit)

Re-verify the full registry against the remediated tree: score every applicable item fresh from current evidence, disposition each of the 51 prior non-PASS findings as FIXED / PARTIALLY FIXED / STILL OPEN, and first-time-score the 15 items that became applicable when widgets, Live Activities, App Intents, and Shortcuts shipped.

## Applicability profile (changes vs v1 in bold)

| Flag | Value | Evidence |
|---|---|---|
| native_ios / swiftui / uikit | true | unchanged; now 4 targets incl. `com.apple.product-type.app-extension` |
| **widgets** | **true** (was false) | `ios/NoMarkupWidget/` — `ActiveBidsWidget`, `NextClosingWidget`, App Group `group.com.nomarkup.app` |
| **live_activities** | **true** (was false) | `AuctionLiveActivityWidget.swift`, `Core/AuctionLiveActivityController.swift`, `NSSupportsLiveActivities` in both plists |
| **app_intents / siri** | **true** (was false) | `ios/NoMarkup/Intents/` — `NoMarkupAppShortcuts` + 4 intents |
| accounts / passwords / third_party_login / sensitive_data / permissions / camera / notifications / push / ipad / app_icon / app_store_distribution | true | unchanged |
| tracking / analytics_sdks / apple_intelligence / on_device_ml / cloud_llm / game / metal / media_playback / health / watch / catalyst / cross_platform / web_only | false | re-verified (AVFoundation import is capture-auth only; `Package.resolved` still Stripe-only) |
| localization | false | `Localizable.xcstrings` exists but en-only (`knownRegions` = en) |

## Executive summary

**108 of 151 items applicable** (was 93 — the widget/LA/intents adoption pulled 15 more into scope); 43 N/A.

| Status | v1 | v2 |
|---|---|---|
| PASS | 42 | **64** |
| FAIL | 15 (3 blocker · 10 major · 2 advisory) | **3 (2 blocker · 0 major · 1 advisory)** |
| GAP | 28 | 29 |
| RISK | 8 | 12 |
| Applicable | 93 | 108 |

**Of the 51 prior non-PASS findings: 20 fully fixed (now PASS), 28 partially fixed (narrowed, still open), 3 unchanged.** One prior PASS regressed (IOS-A11Y.1 — the new widget/Live Activity surfaces ship without accessibility labels). All 10 prior major FAILs cleared. Normalization note: the quality agent reported 7 items as "PARTIAL"; per the registry status vocabulary these are recorded as GAP, except IOS-PERF.6 which is recorded as FAIL because current code still directly contradicts the required rule on a reachable path.

### What forces NOT READY (both are small)

1. **IOS-DIST.7 / IOS-PRI.7 — the shipped privacy manifest contains a false declaration** (blocker FAIL, required). `PrivacyInfo.xcprivacy` asserts "No Required Reason APIs" with an empty `NSPrivacyAccessedAPITypes`, but `Core/BiometricGate.swift:17-18` (`UserDefaults.standard`) and `Core/WidgetSharedStore.swift:33-34` (app-group `UserDefaults`) are live in **both** targets, and the widget ships no manifest at all — the exact ITMS-91053 upload-rejection shape. The manifest and the §4.2 label plan also drift in both directions (six §4.2 types missing from the manifest; DOB + Sensitive Info missing from §4.2), and the ASC label is not entered. *Fix: one `NSPrivacyAccessedAPICategoryUserDefaults` entry (reasons `CA92.1`/`1C8F.1`), a widget manifest, one reconciliation pass, then enter the label.*
2. **IOS-PERF.6 — one main-thread image-work path survived the fix** (blocker FAIL, required). The de-`@MainActor` refactor is real (detached downsample+encode, `nonisolated` helpers) but `normalizedSourceData(from:)` at `Core/ImageUploader.swift:194-204` still runs a **full-resolution `UIGraphicsImageRenderer` redraw + `pngData()` on the main actor** for every camera capture before the detached hop. *Fix: delete the redraw (the downsampler already applies orientation via `kCGImageSourceCreateThumbnailWithTransform: true` at `:226`) or move it inside the existing `Task.detached`.*

### Blocker-severity items that are not FAILs

- **IOS-SEC.1** (RISK, blocker, required) — cleartext is dead (empty plist key, Release-side non-HTTPS rejection in `AppConfig.swift:56-75`, regression-tested in `AppConfigTests.swift:19-31`), but the new SIWA nonce doesn't bind: the client discards the raw nonce and sends the hash (`SignInWithAppleButton.swift:22-30`), and the gateway compares that to the token claim without re-hashing (`oauth.go:557`) — a tautology, with nonce optional (`oauth.go:576`). No replay binding exists. *Fix: pass the raw nonce through; gateway re-hashes and requires it for native clients.*
- **IOS-DIST.1** (RISK, blocker, required) — Xcode-26 floor now correctly documented (`ios/README.md:13-27`) and `scripts/ios-archive-lint.sh` mechanically checks it (plus version + export-compliance keys), but **nothing invokes the lint** — no scheme pre-action, no Makefile target, no CI (zero macOS runners; all 21 `runs-on:` are ubuntu). *Fix: wire it into the scheme's Archive pre-action.*
- **IOS-DES.20** (GAP, blocker, required) — static clipping risk is largely engineered away (0 fixed fonts), but the device matrix (now correctly SE/Pro Max/iPad/AX5/iOS-17) has **zero executed rows and a blank sign-off block**.
- **IOS-A11Y.1** (GAP, blocker, required — regression) — app labeling held (267 labels), but all 381 lines of widget/Live Activity UI carry **zero accessibility modifiers**.

### Top 5 actions

1. **Truthful privacy manifest** (DIST.7/PRI.7): UserDefaults entry with `CA92.1` + `1C8F.1`, widget-target manifest, reconcile manifest ↔ §4.2 both directions, enter the ASC label. Clears blocker FAIL #1.
2. **Finish the image off-main fix** (PERF.6, PERF.3): make `normalizedSourceData` non-isolated or delete the redundant redraw; call the currently-dead `ImageUploader.configureCache()` from `NoMarkupApp.init()`; add a memory-warning cache purge. Clears blocker FAIL #2.
3. **Make the SIWA nonce real and fix launch-blocking config artifacts** (SEC.1, SEC.9, DIST.1): raw-nonce pass-through + gateway re-hash + required-for-native; delete the literal `TEAMID.com.nomarkup.app` entries from the AASA (they sit beside the real `6L6565278C` prefix and risk invalidating the file — also the passkey prerequisite); wire `ios-archive-lint.sh` into the Archive pre-action; hide the dead-end "Sign in with Passkey" button while `isServerReady == false` (SEC.3).
4. **Wire the new system surfaces you shipped** (LA.1, LA.2, WD.3, NT.3, NT.4, A11Y.1): `AuctionLiveActivityController.end()` has zero callers (activities linger until the system reaper); the Lock Screen presentation has no `widgetURL` (most-common tap goes to app root); content never updates after the user's own bid (`pushType: nil`, no WebSocket hook); `WidgetCenter.reloadTimelines` is never called and `setActiveBidCount` has zero callers (widgets show stale/0 data); unregister-on-signout runs on only 1 of ~18 `signOut()` paths (next user on the device inherits pushes); no `interruption-level`/`thread-id` and server still sends `sound: default` + priority 10 on promo pushes; label the widget/LA views for VoiceOver.
5. **Execute the human gates** (DES.20, TEST.3, DIST.2, DIST.5, DIST.6, DIST.8): run and sign M-SE/M-PM/M-IPAD/M-AX5/M-17, run the AX-VO pass and claim VoiceOver only, capture the 6.9"/13" screenshot set, create the ASC record, enter age rating + labels.

### Modernization highlights

The v1 opportunity list is now largely **adopted** (Live Activities, widgets, App Intents shipped; LA.4/WD.5/INT.7/AI.1 all PASS). The next tier: entity layer (`AppEntity`/`IndexedEntity` → Spotlight + Visual Intelligence, INT.2/AI.11), `AppIntentConfiguration` widget configurability (WD.4), Control Center controls reusing the existing intents (MISC.2), push-updated Live Activities (LA.3), Liquid Glass chrome — the iOS-26 `scrollEdgeAppearance` gate exists but is neutralized by 70 unconditional `.toolbarBackground(.visible)` sites (DES.4/DES.9), and passkey server endpoints + registration (SEC.2).

---

## Findings

Full schema for open items; PASS as one-liners. Prior disposition marked. (Quality "PARTIAL" statuses normalized per the executive-summary note.)

### 01 — Design (22: 12 PASS · 1 FAIL · 5 GAP · 1 RISK · 3 N/A) — prior: 9 PASS · 5 FAIL · 4 GAP · 1 RISK

**PASS**: DES.1, DES.2, DES.5, DES.10 (residual: widget hardcodes `Color(red:)` off-`BrandTheme`), DES.11, DES.15, DES.17, DES.18, DES.19 — all held. **Newly PASS (FIXED)**: DES.3 (0 `.system(size:)` remain, was 69; forced dark removed — all 50 `preferredColorScheme(.dark)` hits are `#Preview`-only; `@ScaledMetric` added; `AccentColor` has dark variant), DES.8 (push prompt moved behind value-moment pre-prompt with Settings-link denial recovery), DES.12 (`NavigationSplitView` + `horizontalSizeClass` on Jobs/Marketplace/Messages; `brandReadableWidth()` 720pt cap).

### [IOS-DES.4] Liquid Glass — scroll-edge gate added but neutralized; zero glass adoption
- Status: RISK · Severity: major · Kind: opportunity — **PARTIALLY FIXED**
- Evidence: `BrandTheme.swift:152-156,172-176` now leave `scrollEdgeAppearance` to the system on iOS 26+, but 70 unconditional `.toolbarBackground(.visible)` SwiftUI sites re-pin opaque bars on every screen; zero `glassEffect`/`GlassEffectContainer` in tree.
- Remediation: Remove/gate the 70 `.visible` pairs; adopt `.glassEffect()` on floating CTAs behind `#available(iOS 26)`.
- Doc: https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass · Confidence: 9

### [IOS-DES.6] Icon appearance slots declared, but all three point at the same PNG
- Status: GAP · Severity: major · Kind: recommended — **PARTIALLY FIXED**
- Evidence: `AppIcon.appiconset/Contents.json` now declares universal + `luminosity: dark` + `tinted`, but the directory holds exactly one image; no distinct dark art, no grayscale tinted source, no Icon Composer output. `asc-packaging-checklist.md:213` still says "Open" (stale in the other direction).
- Remediation: Author real dark + tinted 1024 variants (or Icon Composer layered `.icon`); update §6.4.
- Doc: https://developer.apple.com/design/ · Confidence: 9

### [IOS-DES.7] Cited swipe-only deletes fixed; four more remain and `EditButton` is absent tree-wide
- Status: GAP · Severity: major · Kind: required — **PARTIALLY FIXED**
- Evidence: QuoteTemplates + BusinessFeaturesHub now pair swipe with `.contextMenu`; still swipe/`.onDelete`-only: `SavedSearchesView.swift:122-124`, `WishlistView.swift:138-140` (copy says "Swipe to remove"), `MyBidsView.swift:155-164` retract, `PropertiesView.swift:130-142`; zero `EditButton` anywhere.
- Remediation: `EditButton()` or `.contextMenu` mirrors on the four remaining sites.
- Doc: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios · Confidence: 9

### [IOS-DES.9] Opaque `.toolbarBackground(.visible)` still suppresses scroll-edge behavior app-wide
- Status: FAIL · Severity: advisory · Kind: recommended — **STILL OPEN** (unchanged; 70 sites, 0 gated)
- Remediation: Delete the `.visible` line at all 70 sites; rely on `UINavigationBarAppearance`.
- Doc: https://developer.apple.com/design/human-interface-guidelines/layout · Confidence: 9

### [IOS-DES.14] Screenshot plan corrected to 6.9"/13"; zero assets produced
- Status: GAP · Severity: advisory · Kind: opportunity — **PARTIALLY FIXED** (new `app-store-screenshot-matrix.md` is correct; all capture boxes `[ ]`)
- Doc: https://developer.apple.com/design/resources/ · Confidence: 9

### [IOS-DES.16] Codenames: two fixed, one remains
- Status: GAP · Severity: advisory · Kind: recommended — **PARTIALLY FIXED**
- Evidence: ProviderWorkspace/AccountView copy cleaned; `JobDetailView.swift:688-691` still renders "(FR-3.10)" in a user-visible footer — the only remaining string-literal requirement ID.
- Remediation: Move `FR-3.10` to the adjacent comment.
- Doc: https://developer.apple.com/ios/whats-new/ · Confidence: 10

### [IOS-DES.20] Static quality engineered; human device pass still unexecuted
- Status: GAP · Severity: blocker · Kind: required — **PARTIALLY FIXED**
- Evidence: 0 fixed fonts, reflow on money text, no placeholder copy; but `device-smoke-checklist.md` has 0 checked boxes, blank sign-off (`:99-110`); `launch-board.md:77` "pending human device pass".
- Remediation: Execute + sign M-SE, M-PM, M-IPAD, M-AX5, M-17 against build 1.0.0 (3).
- Doc: https://developer.apple.com/ios/get-started/ · Confidence: 10

**N/A**: DES.13, DES.21, DES.22.

### 02 — Privacy & Security (24: 15 PASS · 0 FAIL · 4 GAP · 1 RISK · 4 N/A) — prior: 13 PASS · 1 FAIL · 5 GAP · 1 RISK

**PASS**: PRI.1, PRI.2, PRI.3 (+ new accurate `NSFaceIDUsageDescription`), PRI.4, PRI.8, PRI.11 (now biometric-gated), SEC.4 (advisory note: `signOut()` doesn't clear `WidgetSharedStore` — auction data persists on Lock Screen widgets after logout), SEC.6 (Google button now hidden when unconfigured), SEC.8, SEC.10 (single deliberate host-only NSLog), SEC.11, SEC.12, SEC.13. **Newly PASS (FIXED)**: SEC.5 (ATS: zero exception keys anywhere, incl. widget plist; defense-in-depth via AppConfig), SEC.7 (`BiometricGate` — real `evaluatePolicy(.deviceOwnerAuthentication)` with passcode fallback gating account deletion + payment-method removal; opt-in by design).

### [IOS-SEC.1] Cleartext fixed and tested; SIWA nonce is sent pre-hashed so the gateway check is a tautology
- Status: RISK · Severity: blocker · Kind: required — **PARTIALLY FIXED**
- Evidence: FIXED half — `Info.plist:64-65` empty; `AppConfig.swift:56-60,70-75,95,108` rejects non-HTTPS in Release (regression-tested `AppConfigTests.swift:19-31`). OPEN half — `SignInWithAppleButton.swift:22-30` stores only the hashed nonce and sends it to the gateway; `gateway/internal/handler/oauth.go:557` compares without re-hashing (value already inside the id_token → no replay binding) and `:576` makes it optional.
- Remediation: Keep the raw nonce client-side, send it in the exchange; gateway: `sha256hex(req.Nonce) == claims.Nonce`, required for native.
- Doc: https://developer.apple.com/ios/get-started/ · Confidence: 9

### [IOS-PRI.7] Manifest real and accurate on data types; Required-Reason declaration false; widget unmanifested
- Status: GAP · Severity: major · Kind: required — **PARTIALLY FIXED** (see IOS-DIST.7 for the full defect; same root cause)
- Doc: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files · Confidence: 9

### [IOS-SEC.2] Passkey assertion code shipped but kill-switched; no registration; no server endpoints
- Status: GAP · Severity: major · Kind: recommended — **PARTIALLY FIXED**
- Evidence: `Auth/PasskeyAuth.swift:79-108` is a real assertion flow; `isServerReady` env-gated false (`:19-25`); no `createCredentialRegistrationRequest`; gateway has no WebAuthn handlers (`APIClient+Auth.swift:247-269` "client stubs").
- Remediation: Gateway passkey endpoints + enrollment path + server-driven flag.
- Doc: https://developer.apple.com/passkeys · Confidence: 9

### [IOS-SEC.3] Login shows a passkey button that always dead-ends
- Status: GAP · Severity: advisory · Kind: opportunity — **STILL OPEN** (worsened UX-wise: `LoginView.swift:330` renders "Sign in with Passkey" → "coming soon" alert)
- Remediation: Hide while `!isServerReady`; combined passkey+password request when live.
- Doc: https://developer.apple.com/passkeys · Confidence: 8

### [IOS-SEC.9] Entitlement + router real; AASA ships a literal `TEAMID.` placeholder and an orphan `/orders` route
- Status: GAP · Severity: major · Kind: recommended — **PARTIALLY FIXED**
- Evidence: Entitlements `applinks:`/`webcredentials:no-markup.com`; `onOpenURL` → `DeepLinkRouter` (`NoMarkupApp.swift:84-86`, `Core/DeepLinkRouter.swift:113-159`). AASA (`web/public/.well-known/apple-app-site-association`) lists real `6L6565278C.com.nomarkup.app` **and** placeholder `TEAMID.com.nomarkup.app` in both `applinks` and `webcredentials`; AASA claims `/orders*` but the router returns `nil` for orders.
- Remediation: Delete both `TEAMID.*` entries; add an `orders` route or drop the AASA components; verify served `Content-Type`.
- Doc: https://developer.apple.com/documentation/authenticationservices · Confidence: 9

**N/A**: PRI.5, PRI.6, PRI.9, PRI.10 (flags re-verified).

### 03 — System Experiences (26: 9 PASS · 0 FAIL · 7 GAP · 9 RISK · 1 N/A) — prior: 0 PASS · 5 FAIL · 5 RISK · 16 N/A; 15 items newly applicable

**PASS**: **NT.2 FIXED** (in-context pre-prompt at bid/watchlist moments; `syncIfAuthorized` never prompts; denied path has Settings deep-link) · **NT.5 FIXED** (server computes `badge` from unread count; client clears on active/tap/mark-all-read) · **MISC.3 FIXED** (`UIBackgroundModes` removed everywhere; server never sends `content-available`) · **LA.4 / WD.5 / INT.7 FIXED** (adoption shipped) · WD.1 (widgets are glanceable, deep-linked, placeholder-correct) · WD.2 (Home + Lock Screen families with per-family layouts) · INT.8 (pure App Intents, no SiriKit debt).

### [IOS-SYS.LA.1] Live Activity is started but never ended — `end()` has zero callers
- Status: RISK · Severity: major · Kind: opportunity — newly applicable
- Evidence: `AuctionLiveActivityController.end(auctionID:)` (`:83-99`) uncalled repo-wide; no auction-closed/outbid/lifecycle hook; `AuctionWebSocketClient` has no ActivityKit reference. Start side is correct (bid-triggered, `staleDate: endsAt`).
- Remediation: Call `end()` from auction-closed/won/lost WebSocket events + bid-withdraw; launch-time sweep of stale activities.
- Doc: https://developer.apple.com/design/human-interface-guidelines/live-activities/ · Confidence: 9

### [IOS-SYS.LA.2] Lock Screen tap has no deep link; content freezes after the user's own bid
- Status: RISK · Severity: major · Kind: recommended — newly applicable
- Evidence: `.widgetURL` only on the Dynamic Island (`AuctionLiveActivityWidget.swift:81`), not the Lock Screen view (`:12-41`); `pushType: nil` + no WebSocket update path → `leadingBidCents` shows the user's own bid as leading forever; bare "High/Low" label (`:45`).
- Remediation: `widgetURL` on both presentations; WebSocket outbid events → `startOrUpdate`.
- Doc: https://developer.apple.com/design/human-interface-guidelines/live-activities/ · Confidence: 9

### [IOS-SYS.LA.3] No push-updated Live Activities
- Status: GAP · Severity: advisory · Kind: opportunity — newly applicable. `pushType: nil`; server has no `liveactivity` push type (`apns.go:159` hardcodes `alert`). Remediation: `pushType: .token` + `liveactivity` payload branch. Doc: https://developer.apple.com/notifications/ · Confidence: 9

### [IOS-SYS.WD.3] Sound timeline policies, but nothing reloads them and the snapshot is bid-only
- Status: RISK · Severity: advisory · Kind: recommended — newly applicable
- Evidence: Zero `WidgetCenter` calls in tree; `WidgetSharedStore.setActiveBidCount` has zero callers; snapshot written only from Live-Activity start/update/end — a user with existing bids sees "0 / No active auctions"; no `TimelineEntryRelevance`.
- Remediation: `reloadTimelines` from `WidgetSharedStore.save`; sync from `MyBidsView.load()` + cold launch; relevance by time-to-close.
- Doc: https://developer.apple.com/design/human-interface-guidelines/widgets/ · Confidence: 9

### [IOS-SYS.WD.4] StaticConfiguration only — multi-auction domain with no widget configurability
- Status: GAP · Severity: advisory · Kind: opportunity — newly applicable. Remediation: `AppIntentConfiguration` + `AuctionEntity` picker. Doc: https://developer.apple.com/ios/whats-new/ · Confidence: 9

### [IOS-SYS.NT.1] Opt-down now reachable; still zero rate limiting, and the cited dedupe table doesn't exist
- Status: RISK · Severity: major · Kind: required — **PARTIALLY FIXED**
- Evidence: FIXED — 14 seeded per-type rows, writable global toggles, server honors prefs, push defaults false. OPEN — no rate/cooldown/quiet-hours code in `services/notification/`; `reengagement.go:11-14` cites `notifications.delivery_log` which exists nowhere in the tree; promo schedulers share the unthrottled fan-out.
- Remediation: Per-user/per-class send ledger + cooldown inside `SendNotification`; implement or un-cite `delivery_log`.
- Doc: https://developer.apple.com/notifications/ · Confidence: 9

### [IOS-SYS.NT.3] Categories + tap routing landed; interruption levels, thread grouping, action handling didn't
- Status: RISK · Severity: major · Kind: recommended — **PARTIALLY FIXED**
- Evidence: FIXED — 4 categories registered, server sends `aps.category`, `didReceive` routes through `DeepLinkRouter` into `RootTabView`. OPEN — no `interruption-level` (all pushes `apns-priority: 10` incl. welcome/price-drop), no `thread-id` (outbid alerts never group), `response.actionIdentifier` ignored (DISMISS navigates like VIEW), 4 types arrive actionless.
- Remediation: `time-sensitive`/`passive` levels, priority 5 for promo, `thread-id` per auction, branch on actionIdentifier.
- Doc: https://developer.apple.com/design/human-interface-guidelines/managing-notifications · Confidence: 9

### [IOS-SYS.NT.4] Real APNs provider ships; sign-out unregisters on only 1 of ~18 paths; no 410 pruning; no Push Console step
- Status: RISK · Severity: major · Kind: recommended — **PARTIALLY FIXED**
- Evidence: FIXED — genuine HTTP/2 token-auth provider (`apns.go`: ES256 JWT 50-min refresh, sandbox/prod hosts, correct headers), platform routing, env config, log-only dev fallback; unregister called before `signOut()` in `AccountView.swift:165-170`. OPEN — the other ~17 `auth.signOut()` sites never unregister (next device user inherits pushes); `push.go:95-101` logs 410s without pruning; no Push Console validation step in ops docs; `aps-environment=development` relies on the documented archive-rewrite (unverified by anything in tree).
- Remediation: Move unregister into `AuthViewModel.signOut()`; prune on 410; add a Push Console test line to the packaging checklist.
- Doc: https://developer.apple.com/notifications/push-notifications-console/ · Confidence: 9

### [IOS-SYS.NT.6] Foreground sound now type-aware; wire still sends `sound: default` on everything
- Status: RISK · Severity: advisory · Kind: recommended — **PARTIALLY FIXED** (`willPresent` classifier correct; `apns.go:193` unconditional `sound: default` + priority 10 means background promo pushes still ring)
- Remediation: Omit `sound`/set `passive` server-side for the promo set the client already classifies.
- Doc: https://developer.apple.com/design/human-interface-guidelines/managing-notifications · Confidence: 9

### [IOS-INT.1] Four intents ship; all are open-app shims with no entities and no auth guards
- Status: RISK · Severity: major · Kind: opportunity — newly applicable (adoption itself = INT.7 PASS)
- Evidence: All four set `openAppWhenRun = true`, return bare `.result()`; zero `AppEntity`; invoked signed-out they "succeed" while stranding the user on LoginView (route silently dropped — `RootTabView` only mounts when authenticated).
- Remediation: Throw `needsToContinueInAppError()` when unauthenticated; add entities; make MyBids return a value+dialog.
- Doc: https://developer.apple.com/documentation/appintents · Confidence: 9

### [IOS-INT.2] No entity schemas / Spotlight indexing — GAP · major · recommended — newly applicable. Zero `AppEntity`/`IndexedEntity`/`CoreSpotlight`; models + deep-link routes already exist to back them. Doc: https://developer.apple.com/ios/whats-new/ · Confidence: 9
### [IOS-INT.3] English-only literal phrases, no schema conformance — GAP · advisory · opportunity — newly applicable. Doc: https://developer.apple.com/ios/whats-new/ · Confidence: 9
### [IOS-INT.4] No View Annotations (blocked on INT.2) — GAP · advisory · opportunity — newly applicable. Doc: https://developer.apple.com/ios/whats-new/ · Confidence: 8
### [IOS-INT.5] Zero App Intents tests (the signed-out defect in INT.1 is what they'd catch) — GAP · major · recommended — newly applicable. Doc: https://developer.apple.com/ios/whats-new/ · Confidence: 9
### [IOS-INT.6] No `ParameterSummary`; raw-UUID parameter; empty results (nothing chainable) — RISK · advisory · recommended — newly applicable. Doc: https://developer.apple.com/design/human-interface-guidelines/app-shortcuts · Confidence: 9
### [IOS-SYS.MISC.2] No Control Center controls despite ready-made intents — GAP · advisory · opportunity — newly applicable; small lift (`ControlWidgetButton` over existing intents). Doc: https://developer.apple.com/ios/ · Confidence: 9

**N/A**: MISC.1 (App Clips — 4 targets only, re-confirmed).

### 04 — Intelligence (18: 4 PASS · 1 GAP · 13 N/A) — prior: 3 PASS · 2 GAP

**PASS**: **AI.1 FIXED** (App Intents surface satisfies the disjunctive check; residual = entity indexing, tracked at INT.2) · AI.9, AI.10, AI.18 (blocker no-false-claims — re-verified clean incl. modified ASC copy). **GAP**: AI.11 Visual Intelligence — STILL OPEN but narrowed to the entity layer; formally deferred post-launch in `ios-developer-audit-remediation-2026-07-27.md:88`. **N/A**: 13 (flags re-verified).

### 05 — Quality (27: 13 PASS · 1 FAIL · 6 GAP · 7 N/A) — prior: 10 PASS · 3 FAIL · 7 GAP

**PASS**: **A11Y.2 FIXED** (0 fixed fonts, was 69; money text scales + reflows; 11 `minimumScaleFactor`) · A11Y.4, A11Y.7, L10N.4, PERF.1, PERF.2, PERF.4, PERF.5, TEST.4, MP.2 held · **A11Y.6 FIXED** (`accessibility-nutrition-claims.md` — strict under-claiming; two stale-conservative rows to refresh) · **TEST.2 FIXED** (`testflight-process.md` end-to-end; honest "no fastlane" caveat) · **MP.1 FIXED** (split-view adoption).

### [IOS-A11Y.1] App labeling held; widget + Live Activity surfaces ship with zero accessibility
- Status: GAP · Severity: blocker · Kind: required — **REGRESSION on new surface** (prior PASS)
- Evidence: App: 267 labels/191 hints (grew with the UI). `grep accessibility ios/NoMarkupWidget/` → 0 matches across 381 lines; unlabeled count block (`ActiveBidsWidget.swift:123-128`), raw `Text(timerInterval:)` countdowns.
- Remediation: `accessibilityElement(children: .combine)` + labels per widget family + LA regions; add a widget row to the claims doc.
- Doc: https://developer.apple.com/documentation/accessibility · Confidence: 9

### [IOS-A11Y.3] Reduce Motion + un-forced dark landed; Transparency/Contrast/Differentiate still absent
- Status: GAP · Severity: major · Kind: required — **PARTIALLY FIXED** (motion helper wired root + Messages; zero `reduceTransparency`/`colorSchemeContrast`/`differentiateWithoutColor`; literal palette without high-contrast variants; widget colors hardcoded)
- Doc: https://developer.apple.com/ios/ · Confidence: 9

### [IOS-L10N.5] Catalog + `SWIFT_EMIT_LOC_STRINGS` on the right targets; extraction never run, plurals unconverted
- Status: GAP · Severity: advisory · Kind: recommended — **PARTIALLY FIXED** (5 manual entries vs thousands of literals; 12+ hand-rolled `== 1 ? "" : "s"` plurals remain)
- Doc: https://developer.apple.com/ios/get-started/ · Confidence: 9

### [IOS-PERF.3] Downsampling shipped; the new cache bound is dead code; no memory-warning handling
- Status: GAP · Severity: major · Kind: required — **PARTIALLY FIXED**
- Evidence: ImageIO downsample at ≤2048px with `kCGImageSourceShouldCache: false` — the ~190MB full-decode path is gone. `configureCache()` (64MB/256MB, `ImageUploader.swift:67-75`) has **zero callers**; no `didReceiveMemoryWarning` observer.
- Remediation: One line — call `ImageUploader.configureCache()` from `NoMarkupApp.init()`; add a warning-triggered purge.
- Doc: https://developer.apple.com/documentation/xcode/improving-your-app-s-performance · Confidence: 9

### [IOS-PERF.6] De-`@MainActor` refactor real; camera path still redraws + PNG-encodes full-res on main
- Status: FAIL · Severity: blocker · Kind: required — **PARTIALLY FIXED** (see executive summary; `ImageUploader.swift:194-204` vs the detached hop at `:176-189`)
- Remediation: Delete the redundant redraw (orientation already applied at `:226`) or move it into the detached task; if kept, JPEG not PNG.
- Doc: https://developer.apple.com/documentation/xcode/improving-your-app-s-performance · Confidence: 9

### [IOS-TEST.1] Real unit target (32 tests / 92 asserts); zero iOS CI and self-skipping UI tests remain
- Status: GAP · Severity: major · Kind: recommended — **PARTIALLY FIXED** (no `xcodebuild`/macOS anywhere in workflows — 21× ubuntu; no APIClient-refresh/Keychain tests; 2 of 3 UI tests skip without creds)
- Remediation: `macos-15` job running the already-documented xcodebuild command; refresh/Keychain tests via mock `URLProtocol`; CI creds.
- Doc: https://developer.apple.com/ios/get-started/ · Confidence: 9

### [IOS-TEST.3] Matrix corrected (SE/iPad/AX5/17.0); zero rows executed, sign-off blank
- Status: GAP · Severity: major · Kind: recommended — **PARTIALLY FIXED** (same gate as DES.20/DIST.2)
- Doc: https://developer.apple.com/ios/get-started/ · Confidence: 9

**N/A**: A11Y.5, L10N.1–3, MP.3–5 (flags re-verified; AVFoundation is capture-auth only).

### 06 — Games & Media (16: 2 PASS · 14 N/A) — prior: 1 PASS · 1 GAP

**PASS**: **MED.5 FIXED** (three-state camera authorization + Settings deep-link at all 3 call sites; orientation baked into pixels via renderer redraw + `ThumbnailWithTransform` — server `AutoOrient=false`/EXIF-strip now harmless; the main-actor placement of the redraw is tracked under PERF.6) · MED.6 held. **N/A**: 14 (import census re-confirmed; no playback surface appeared).

### 07 — Distribution (18: 9 PASS · 1 FAIL · 6 GAP · 1 RISK · 1 N/A) — prior: 6 PASS · 1 FAIL · 9 GAP · 1 RISK

**PASS**: DIST.3, DIST.9, DIST.10, DIST.12 (free-tier lock restated; zero StoreKit symbols; "Manage on web" only), DIST.17, DIST.18 held (both ASR residuals re-verified; API-host reachability now purely ops) · **Newly PASS (FIXED)**: DIST.13 + DIST.14 (dated deliberate deferrals recorded), DIST.15 (`ITSAppUsesNonExemptEncryption=false` in the binary, lint-enforced).

### [IOS-DIST.1] Floor documented + lint script exists; nothing invokes it
- Status: RISK · Severity: blocker · Kind: required — **PARTIALLY FIXED** (see executive summary; `scripts/ios-archive-lint.sh` referenced only in prose; scheme ArchiveAction has no pre-action; zero macOS CI)
- Remediation: Wire the lint into the scheme Archive pre-action or a `make ios-archive` path.
- Doc: https://developer.apple.com/ios/submit/ · Confidence: 8

### [IOS-DIST.2] Matrix corrected; zero executed rows, blank sign-off — GAP · major · required — **PARTIALLY FIXED** (execute M-* rows against 1.0.0 (3)) · Confidence: 9
### [IOS-DIST.4] TestFlight process documented; no ASC record/group/upload/automation — GAP · major · recommended — **PARTIALLY FIXED** · Confidence: 9
### [IOS-DIST.5] Sizes fixed to 6.9"/13"; zero screenshots; §6.4 icon row now stale the other way — GAP · major · required — **PARTIALLY FIXED** · Confidence: 9
### [IOS-DIST.6] Age-rating answers ready and honest; not entered (no ASC record) — GAP · major · required — **PARTIALLY FIXED** · Confidence: 9

### [IOS-DIST.7] Push/label contradiction resolved; manifest ships a false Required-Reason declaration; widget unmanifested; label not entered
- Status: FAIL · Severity: blocker · Kind: required — **PARTIALLY FIXED** (full evidence in executive summary; manifest↔§4.2 drift both directions: §4.2 declares Physical Address/Other Contact/Support/Purchase History/Coarse Location/User ID absent from the manifest; manifest's DOB + Sensitive Info absent from §4.2)
- Remediation: UserDefaults entry (`CA92.1`/`1C8F.1`) + widget manifest + single reconciled type list + enter the ASC label.
- Doc: https://developer.apple.com/app-store/app-privacy-details/ · Confidence: 9

### [IOS-DIST.8] Claims doc strict and honest; AX-VO verification pass + ASC entry pending — GAP · major · recommended — **PARTIALLY FIXED** · Confidence: 9
### [IOS-DIST.16] 1.0.0/3 consistent across all 8 configs + lint; no What's New source, manual build bump, one stale doc line — GAP · advisory · recommended — **PARTIALLY FIXED** · Confidence: 9

**N/A**: DIST.11 (re-confirmed).

---

## Out-of-registry observations

- **OBS-1 (v1) — Google sign-in configuration**: RESOLVED in effect — the button is now hidden when `GoogleIosClientID` is unconfigured (`LoginView.swift:33`, `AppConfig.swift:230-232`). Release configuration still needs the real client ID + reverse scheme before enabling.
- **OBS-3 (new) — widget data outlives the session**: `signOut()` clears the Keychain but not `WidgetSharedStore`, so auction titles/bid amounts keep rendering on Home/Lock Screen widgets after logout (shared-device privacy nit). One line: `WidgetSharedStore.save(.empty)` in `AuthViewModel.signOut()`. Pairs with the NT.4 unregister gap.
- **OBS-2 (v1, unchanged)**: hand-authored pbxproj object IDs (`P1…`, `W1…`, `T1…`, `F1…`) — cosmetic; Xcode will rewrite on next GUI edit.

## Registry coverage

| Section | Items | Applicable (v1→v2) | PASS | FAIL | GAP | RISK | N/A |
|---|---|---|---|---|---|---|---|
| Design | 22 | 19→19 | 12 | 1 | 5 | 1 | 3 |
| Privacy & Security | 24 | 20→20 | 15 | 0 | 4 | 1 | 4 |
| System Experiences | 26 | 10→25 | 9 | 0 | 7 | 9 | 1 |
| Intelligence | 18 | 5→5 | 4 | 0 | 1 | 0 | 13 |
| Quality | 27 | 20→20 | 13 | 1 | 6 | 0 | 7 |
| Games & Media | 16 | 2→2 | 2 | 0 | 0 | 0 | 14 |
| Distribution | 18 | 17→17 | 9 | 1 | 6 | 1 | 1 |
| **Total** | **151** | **93→108** | **64** | **3** | **29** | **12** | **43** |

All seven section agents completed; every cited `IOS-*` ID grep-verified against the registries (incl. the 15 newly-applicable system IDs — 0 missing).

## Prior-finding disposition (51 findings from v1)

- **Fixed → PASS (20)**: DES.3, DES.8, DES.12, SEC.5, SEC.7, NT.2, NT.5, MISC.3, LA.4, WD.5, INT.7, AI.1, MED.5, A11Y.2, A11Y.6, TEST.2, MP.1, DIST.13, DIST.14, DIST.15
- **Partially fixed, still open (28)**: DES.4, DES.6, DES.7, DES.14, DES.16, DES.20, SEC.1, PRI.7, SEC.2, SEC.9, NT.1, NT.3, NT.4, NT.6, A11Y.3, L10N.5, PERF.3, PERF.6, TEST.1, TEST.3, DIST.1, DIST.2, DIST.4, DIST.5, DIST.6, DIST.7, DIST.8, DIST.16
- **Unchanged (3)**: DES.9, SEC.3, AI.11
- **Regressed prior PASS (1)**: A11Y.1 (new widget/LA surfaces unlabeled)
- **Newly applicable, first-time scored (15)**: LA.1–3, WD.1–4, MISC.2, INT.1–6, INT.8 — 4 PASS, 11 open (quality-of-adoption findings)

## Done-when checklist

- [x] All applicable required items scored (108/108 applicable have statuses)
- [x] Every FAIL/GAP has path evidence or explicit "not found in tree"
- [x] Readiness label matches metric rules (2 blocker FAILs on `required` → NOT READY; SEC.1 privacy RISK would independently hold AT RISK)
- [x] Disclaimer present

## Also run `/app-store-compliance` for

Unchanged residuals: 3.1.1 free-tier lock (re-verified intact), review-env API host reachability (now ops-only), UGC review notes, age-rating entry. Re-run after the ASC label + age rating land.

## Disclaimer

This audit maps product evidence to Apple's published iOS developer documentation
hub and linked guidance. It is not legal advice, not App Review, and does not
guarantee App Store approval or feature eligibility. Docs are living; re-verify
against the canonical URLs before shipping. For rejection-risk policy, use
/app-store-compliance.
