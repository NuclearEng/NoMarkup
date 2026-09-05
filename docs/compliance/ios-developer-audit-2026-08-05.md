# iOS Developer Documentation Audit

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup/ios` (monorepo product client)
- **Date**: 2026-08-05
- **Remediation**: 2026-08-05 — see [`ios-developer-audit-remediation-2026-08-05.md`](./ios-developer-audit-remediation-2026-08-05.md)
- **Hub snapshot**: 2026-07-26 — https://developer.apple.com/ios/ (registry age &lt; 90 days; no refresh required)
- **Platform / stack**: Native SwiftUI · Xcode project · deployment **iOS 17.0** · Swift **6.0** · dogfood **Xcode 26.5 / iOS 26.5 SDK**
- **Target SDK bar**: **iOS 26** Submit floor (Xcode 26+); hub also features iOS 27 technologies as modernization opportunity
- **Depth**: standard
- **Orchestration**: 7 parallel read-only section agents (audit) → 5 parallel fix agents + LA fan-out (remediation)
- **Platform readiness**: **READY WITH FOLLOW-UPS** (was **AT RISK**; eng FAILs closed)
- **Related**: App Store rejection-risk policy → `/app-store-compliance` (not scored here)

## Goal (audit)

Map NoMarkup’s native iOS client to Apple’s published iOS developer hub + pathway guidance so the team knows what is platform-ready, what blocks Submit, and what modernization (Liquid Glass, Intelligence) is optional vs required.

## Applicability profile

| Flag | Value | Evidence |
|------|-------|----------|
| `always` | true | iOS App Store target |
| `native_ios` | true | `ios/NoMarkup.xcodeproj` |
| `swiftui` | true | SwiftUI app + widget |
| `uikit` | false | UIKit only for appearance / pickers |
| `cross_platform` / `web_only` | false | Native client |
| `custom_chrome` | true | `BrandTheme`, gold CTAs, custom cards |
| `app_icon` | true | AppIcon 1024 + dark + tinted |
| `accounts` | true | Login / register / JWT session |
| `passwords` | true | Email/password + SIWA + passkeys |
| `third_party_login` | true | Google / Facebook OAuth (optional) |
| `sensitive_data` | true | PII, payments, location, docs |
| `permissions` | true | Location, camera, photos, Face ID |
| `tracking` | false | No ATT / tracking purpose string |
| `analytics_sdks` | false* | SPM = Stripe only (*no Sentry/Firebase in app tree) |
| `widgets` | true | ActiveBids, NextClosing |
| `live_activities` | true | Auction ActivityKit + Dynamic Island |
| `notifications` / `push` | true | UNUserNotification + APNs device register |
| `app_intents` / `siri` | true | Intents + AppShortcuts + Controls |
| `apple_intelligence` / `on_device_ml` / `cloud_llm` | false | No FM / Core ML / third-party LLM |
| `accessibility_target` | true | GUI app |
| `localization` | true | `Localizable.xcstrings`; `knownRegions` en/Base/**es** |
| `game` / `metal` / `media_playback` | false | Marketplace utility only |
| `camera` | true | `CameraImagePicker` + purpose string |
| `ipad` | true | Universal `TARGETED_DEVICE_FAMILY` 1,2 + split views |
| `app_store_distribution` | true | ASC / TestFlight docs + packaging |
| `subscription_or_iap` | scaffold off | `StoreKitEnabled=false` |

## Executive summary

### Counts (post-remediation)

| Bucket | Status |
|--------|--------|
| Sections run | 7 |
| Required **blocker** FAIL | **0** |
| Required **major** FAIL | **0** (SEC.5 closed) |
| Recommended major FAIL | **0** eng (L10N.3, PERF.1 culture closed) |
| GAP remaining | Founder ASC / device / TestFlight upload; DES.14 marketing frames; INT.3/5 opportunity |
| Strong PASS areas | SIWA + passkeys + Keychain; PrivacyInfo; widgets + Live Activities + App Intents; Dynamic Type / Reduce Motion; archive hygiene; badge reconcile; Liquid Glass scroll-edge |

### Top actions remaining (founder / ops)

1. **ASC App Privacy + age rating + screenshots** (DIST.5–7) — eng manifests fixed; portal entry open.
2. **Human device matrix + VO + Instruments capture** (DIST.2 / TEST.3 / PERF.1) — checklists ready.
3. **TestFlight first internal build** (DIST.4) — process documented; upload open.
4. **Accessibility nutrition after VO** (DIST.8).
5. **Live support URL HTTP verify** (DIST.17) — URL is `https://no-markup.com/support`.

### Modernization highlights

| Opportunity | Status |
|-------------|--------|
| Liquid Glass materials | **PASS (eng)** — scroll-edge chrome + glass CTAs |
| App Intents / Shortcuts | **PASS** |
| Live Activities | **PASS** client + server LA push plumbing + fan-out |
| Foundation Models / Apple Intelligence | **N/A** intentional (**IOS-AI.18 PASS**) |
| Widgets + Controls | **PASS** |

## Findings (post-remediation status)

### Design (`01-design.md`)

| ID | Status | Notes |
|----|--------|-------|
| IOS-DES.1–3,5–8,10–12,15–17,19–20 | PASS | Unchanged |
| **IOS-DES.4** | **PASS** | `brandNavigationBarChrome` + `glassProminentBrandCTA` |
| **IOS-DES.9** | **PASS** | No solid-navy toolbar overrides on iOS 26+ |
| IOS-DES.14 | GAP advisory | ASC marketing frames not in tree (ops) |
| IOS-DES.13,18,21,22 | N/A | |

### Privacy & security (`02-privacy-security.md`)

| ID | Status | Notes |
|----|--------|-------|
| IOS-PRI.* / SEC.* (except below) | PASS | |
| **IOS-SEC.5** | **PASS** | Empty `APIBaseURL`; no `NSAllowsLocalNetworking`; archive lint green |
| IOS-SEC.1 residual | cleared | Dogfood via Debug scheme env only |

### System experiences (`03-system-experiences.md`)

| Theme | Result |
|-------|--------|
| Live Activities LA.1,2,4 | PASS |
| **LA.3** | **PASS (eng)** — register, store, APNs liveactivity send, auction notif fan-out |
| Widgets WD.1–5 | PASS |
| Notifications NT.1–3,6 | PASS |
| NT.4 APNs ops console | partial (ops) |
| **NT.5 badge accuracy** | **PASS** — `reconcileBadgeFromServer` |
| App Intents INT.1,4,6,7 | PASS |
| **INT.2 Spotlight delete** | **PASS** — sign-out + 404 |
| INT.3 assistant schemas | partial opportunity |
| INT.5 pathway testing framework | partial opportunity |
| MISC.2 Controls | PASS |
| MISC.3 Background modes | PASS |
| MISC.1 App Clip | N/A |

### Intelligence (`04-intelligence.md`)

Unchanged: 3 PASS · 2 opportunity · 13 N/A · 0 FAIL. **IOS-AI.18 PASS**.

### Quality (`05-quality.md`)

| ID | Status | Notes |
|----|--------|-------|
| IOS-A11Y.1–4,6,7 | PASS | |
| **IOS-L10N.3** | **PASS** | `es` region + tab/empty-state Spanish scaffold |
| **IOS-PERF.1** | **PASS (culture)** | Instruments doc + smoke rows; human capture residual |
| IOS-PERF.2–6 | PASS | |
| IOS-TEST.1,4 | PASS | |
| IOS-TEST.2,3 | Process PASS · human residual | |

### Games / media (`06-games-media.md`)

Unchanged: MED.5/6 PASS · rest N/A.

### Distribution (`07-distribution.md`)

| ID | Status | Notes |
|----|--------|-------|
| **IOS-DIST.1** | **PASS (eng)** | Lint + clean shipping plist |
| IOS-DIST.2 | Process · human residual | Checklist ready |
| IOS-DIST.3 | PASS | |
| IOS-DIST.4 | Process · founder residual | testflight-process.md |
| IOS-DIST.5–8, .17 | Eng pack · founder residual | |
| IOS-DIST.9–10,12,15–16,18 | PASS | |

## Out-of-registry observations

### [OBS-1] LAN dogfood in shared Info.plist
- **CLOSED** with SEC.5.

### [OBS-2] Stripe test keys absent for real Apple Pay dogfood
- Product residual; scheme env `NOMARKUP_STRIPE_PUBLISHABLE_KEY`.

### [OBS-3] Prior audit remediation (2026-07-27) partially regressed
- **CLOSED** — ATS/cleartext re-stripped; lint rejects reintroduction.

## Registry coverage

| Section | Audit | Remediation |
|---------|-------|-------------|
| design | completed | DES.4/9 closed |
| privacy | completed | SEC.5 closed |
| system | completed | NT.5, LA.3, INT.2 closed |
| intelligence | completed | N/A intentional |
| quality | completed | L10N.3, PERF.1 closed |
| games-media | completed | N/A |
| distribution | completed | DIST.1 eng closed; ASC ops residual |

## Done-when checklist

- [x] `$SOURCE` freshness checked
- [x] Applicability profile written with evidence
- [x] In-scope section agents completed (7/7)
- [x] Report file on disk with mandatory sections
- [x] Every prior FAIL has remediation evidence or founder residual label
- [x] Readiness label matches metric rules (**READY WITH FOLLOW-UPS**)
- [x] Disclaimer present
- [x] Remediation doc linked

## Disclaimer

This audit maps product evidence to Apple’s published iOS developer documentation hub and linked guidance. It is **not** legal advice, **not** App Review, and does **not** guarantee App Store approval or feature eligibility. Docs are living; re-verify against the canonical URLs before shipping. For rejection-risk policy (IAP, UGC, metadata), use **`/app-store-compliance`**.

---

## Console summary

**Platform readiness: READY WITH FOLLOW-UPS**

| Priority | Action |
|----------|--------|
| Eng | **Done** — SEC.5, DES.4/9, NT.5, LA.3, INT.2, L10N.3, PERF.1 culture, DIST.1 |
| Founder 1 | ASC privacy nutrition + age rating + screenshots |
| Founder 2 | Device smoke + VO + Instruments sign-off |
| Founder 3 | TestFlight internal upload |
| Founder 4 | A11y nutrition + support URL live check |
