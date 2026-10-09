# iOS Developer Audit Remediation — 2026-08-05

**Source audit:** [`ios-developer-audit-2026-08-05.md`](./ios-developer-audit-2026-08-05.md)  
**Orchestration:** 5 parallel agent teams + parent LA fan-out + verification  
**Date closed (eng):** 2026-08-05  
**Platform readiness after eng close:** **READY WITH FOLLOW-UPS** (founder ASC / human device / TestFlight upload remain)

## Goal

Close every **eng-closeable** FAIL / GAP / RISK from the 2026-08-05 iOS Developer Documentation Audit. Founder-only App Store Connect / physical-device sign-offs are documented as residual ops, not left as open eng debt.

## Verification

| Check | Result |
|-------|--------|
| `DEVELOPER_DIR=…/Xcode-26.5.0.app/… ./scripts/ios-archive-lint.sh` | **PASS** (empty `APIBaseURL`, no ATS local networking, Xcode 26.5, PrivacyInfo, export key) |
| `go test ./services/notification/internal/service/ ./internal/grpc/` | **PASS** |
| `go test ./gateway/internal/handler/ -run DevicePlatform` | **PASS** |
| `xcodebuild test -only-testing:NoMarkupTests` (iPhone 17 sim) | **PASS** |

## Gap → closure matrix

| ID | Was | Now | Evidence |
|----|-----|-----|----------|
| **IOS-SEC.5** | FAIL major required | **CLOSED** | `Info.plist`: empty `APIBaseURL`; `NSAppTransportSecurity` removed. LAN dogfood via scheme `NOMARKUP_API_BASE_URL` only. ProfileAction no longer inherits Launch env cleartext. |
| **IOS-DIST.1** | GAP/RISK | **CLOSED (eng)** | Archive lint green; scheme PreAction + `make ios-archive` already fail-closed on exit codes. Dirty dogfood plist regression fixed. |
| **IOS-DES.4** | GAP | **CLOSED** | `brandNavigationBarChrome()` yields Liquid Glass on iOS 26+; `glassProminentBrandCTA()` on listing bid, job bid, post-job submit. |
| **IOS-DES.9** | GAP | **CLOSED** | 74 solid-navy toolbar overrides → `brandNavigationBarChrome()` (pre-26 keeps navy). |
| **IOS-SYS.NT.5** | GAP | **CLOSED** | `PushRegistration.reconcileBadgeFromServer()`; become-active / deep-link reconcile; RootTabView + NotificationsView keep icon badge = server unread. |
| **IOS-SYS.LA.3** | GAP/partial | **CLOSED (plumbing + fan-out)** | Proto `DEVICE_PLATFORM_IOS_LIVE_ACTIVITY`; gateway map; `SendLiveActivityUpdate`; `dispatchLiveActivityForAuction` on bid/close notif types. Callers should pass `leading_bid_cents` + `ends_at` in data when available for full content-state updates. |
| **IOS-INT.2** | partial | **CLOSED** | `SpotlightIndex.delete` / `deleteAll`; sign-out wipe; job/listing 404 delete. |
| **IOS-L10N.3** | FAIL major recommended | **CLOSED** | `knownRegions` includes `es`; String Catalog EN+ES for tabs + empty states; RootTabView `String(localized:)`. Progressive ES documented in `ios/README.md`. |
| **IOS-PERF.1** | FAIL major recommended | **CLOSED (culture)** | [`ios-instruments-culture.md`](./ios-instruments-culture.md) + device-smoke I1–I3 rows + README link. Human Instruments capture still founder/QA. |
| **IOS-TEST.2 / DIST.4** | GAP | **Process CLOSED · Ops residual** | [`testflight-process.md`](./testflight-process.md) already complete; first ASC upload + Internal group remain founder. |
| **IOS-TEST.3 / DIST.2** | GAP | **Process CLOSED · Ops residual** | [`device-smoke-checklist.md`](./device-smoke-checklist.md) + Instruments rows; human sign-off open. |
| **IOS-DIST.5–8, .17** | GAP | **Eng pack CLOSED · Founder residual** | ASC screenshots, age rating, privacy nutrition portal, a11y nutrition, live support URL verify — eng docs exist; portal entry is founder. |
| **IOS-DES.14** | GAP advisory | **Ops residual** | ASC marketing frames not generated in-repo (screenshot matrix docs only). |
| **IOS-INT.3 / INT.5** | partial | **Accepted residual** | SDK domain limits / system testing framework — opportunity, not ship blocker. |
| **OBS-1** | LAN in shared plist | **CLOSED** | Same as SEC.5. |
| **OBS-3** | ATS regression | **CLOSED** | Re-stripped; archive lint rejects reintroduction. |

## Code / docs touched (high level)

### Security / distribution
- `ios/NoMarkup/Info.plist`
- `ios/NoMarkup.xcodeproj/xcshareddata/xcschemes/NoMarkup.xcscheme`
- `scripts/ios-archive-lint.sh` (already enforced; re-verified)

### Design (Liquid Glass)
- `ios/NoMarkup/Core/BrandTheme.swift` — `brandNavigationBarChrome`, `glassProminentBrandCTA`
- ~60 feature/auth views — toolbar chrome swap

### System
- `ios/NoMarkup/Core/PushRegistration.swift`, `NoMarkupApp.swift`, `RootTabView.swift`, `NotificationsView.swift`
- `ios/NoMarkup/Core/SpotlightIndex.swift` (new) + AuthViewModel / JobDetail / ListingDetail
- `proto/notification/v1/notification.proto` + gen stubs
- `gateway/internal/handler/notification.go` (+ tests)
- `services/notification/internal/service/{push,apns,service}.go` (+ tests)

### Quality
- `ios/NoMarkup/Localizable.xcstrings`, `project.pbxproj` knownRegions
- `docs/compliance/ios-instruments-culture.md`
- `docs/compliance/device-smoke-checklist.md`, `ios/README.md`

## Founder residual checklist (not eng)

1. [ ] ASC App Privacy nutrition labels (DIST.7)
2. [ ] ASC age rating answers (DIST.6)
3. [ ] Screenshots / product page metadata (DIST.5)
4. [ ] TestFlight archive upload + Internal group (DIST.4)
5. [ ] Human device smoke + VoiceOver + Instruments sign-off (DIST.2, TEST.3, PERF.1 capture)
6. [ ] Accessibility nutrition claims after VO (DIST.8)
7. [ ] Live HTTP verify `https://no-markup.com/support` (DIST.17)
8. [ ] Production `APNS_*.env` + AASA at public site

## Readiness label math

- Required **blocker** FAIL: **0**
- Required **major** FAIL: **0** (SEC.5 closed)
- Recommended major FAIL (L10N.3, PERF.1 culture): **closed in eng**
- Remaining: founder ASC / device ops + advisory opportunities (INT.3/5, DES.14 frames)

**Label: READY WITH FOLLOW-UPS** (was AT RISK solely due to SEC.5).

## Disclaimer

Remediation closes engineering evidence against the audit registry. It does **not** replace App Review, legal review, or founder ASC portal work. Re-run `/ios-developer-audit` after the next substantial platform change.
