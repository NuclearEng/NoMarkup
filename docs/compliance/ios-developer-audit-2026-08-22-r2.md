# iOS Developer Documentation Audit

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup` (native client `ios/NoMarkup`)
- **Date**: 2026-08-22 (r2 — post gap-closure)
- **Prior**: [`ios-developer-audit-2026-08-22.md`](./ios-developer-audit-2026-08-22.md) was **NOT READY**
- **Hub snapshot**: 2026-07-26 — https://developer.apple.com/ios/ (registry age 27 days; no refresh)
- **Platform / stack**: Native SwiftUI · `ios/NoMarkup.xcodeproj` · iOS **17.0** · Swift **6.0** · Xcode **26.5** / iOS **26.5** SDK · SPM stripe-ios only
- **Target SDK bar**: iOS 27 hub modernization; iOS 26 SDK Submit floor
- **Depth**: standard (7 section agents)
- **Platform readiness**: **AT RISK**
- **Related**: App Store policy → `/app-store-compliance` (`docs/compliance/app-store-review-2026-08-21.md` still **NOT READY**)

## Goal (audit)

Re-score NoMarkup’s native iOS client after agent-team gap closure so remaining items are only founder/ops (DNS, ASC portal, TestFlight, human device/VO).

## Applicability profile

Unchanged from r1 except `localization` now means catalogs + Foundation hygiene, **not** a shipping `es` storefront (`knownRegions` = `en`, `Base`).

| Flag | Value |
|------|-------|
| `native_ios` / `swiftui` / `app_store_distribution` | true |
| `accounts` / `passwords` / `third_party_login` / `sensitive_data` / `permissions` / `camera` | true |
| `widgets` / `live_activities` / `notifications` / `push` / `app_intents` / `siri` / `ipad` | true |
| `tracking` / `analytics_sdks` / `apple_intelligence` / `on_device_ml` / `cloud_llm` / `game` / `metal` / `media_playback` / `health` / `watch_companion` | false |
| `subscription_or_iap` | scaffold off (`StoreKitEnabled=false`) |

## Executive summary

### Counts vs r1

| Bucket | r1 | r2 |
|--------|---:|---:|
| Registry items | 151 | 151 |
| Applicable | 111 | 111 |
| **PASS** | 87 | **100** |
| **FAIL** | 3 | **1** |
| **GAP** | 19 | **9** |
| **RISK** | 2 | **1** |
| **N/A** | 40 | 40 |
| Required **blocker FAIL** | 1 (`PERF.6`) | **0** |
| Required **major FAIL** | 2 | **1** (`DIST.17`) |

**Readiness math:** no required blocker FAIL → not NOT READY. `IOS-DIST.17` is major required FAIL **and** `IOS-SEC.9` is privacy/security RISK → **AT RISK**.

### Closed this pass (eng)

| ID | Was | Now |
|----|-----|-----|
| IOS-PERF.6 | FAIL blocker | **PASS** — off-main PDF reads |
| IOS-A11Y.2 | FAIL major | **PASS** — Dynamic Type spectator price |
| IOS-PERF.5 | RISK | **PASS** — ≥5 s auction fallback poll |
| IOS-DES.14 | GAP | **PASS** — official Apple bezels required in docs |
| IOS-SEC.2 | GAP | **PASS** — passkey offer after register (flag-gated) |
| IOS-SYS.NT.3 | GAP | **PASS** — `new_message` category + APNs |
| IOS-INT.3 | GAP | **PASS** — `system.search` intent |
| IOS-INT.5 | GAP | **PASS** — `perform()` + `canImport(AppIntentsTesting)` |
| IOS-AI.11 | GAP | **PASS** — Visual Intelligence query/schema (device SDK) |
| IOS-A11Y.1 | GAP | **PASS** — XCUI `performAccessibilityAudit` |
| IOS-A11Y.3 | GAP | **PASS** — contrast tokens + Reduce Motion on spectator |
| IOS-L10N.1 | GAP | **PASS** — `Duration` + string catalog countdown |
| IOS-L10N.3 | GAP | **PASS** — v1 English-only `knownRegions` |

### Remaining (founder / live DNS)

Cannot be closed from this repo without Apple Developer / Cloudflare / human device:

1. **`IOS-DIST.17` FAIL** — `https://no-markup.com/support` DNS NXDOMAIN (in-app native Support + mailto **does not** make the store URL 200).
2. **`IOS-SEC.9` RISK** — live AASA/`webcredentials` unverified until the same DNS exists; do not enable server `passkeys` until then.
3. **ASC portal** — privacy nutrition (`DIST.7` blocker GAP), age (`DIST.6`), screenshots (`DIST.5`), TestFlight (`DIST.4` / `TEST.2`).
4. **Human matrix** — SE / 13″ iPad / AX5 / iOS 17 (`DIST.2` / `TEST.3`); VoiceOver nutrition (`DIST.8`).
5. **Push Console** — `IOS-SYS.NT.4` GAP.

### Top 5 actions now

1. Provision `no-markup.com` so `/support` returns HTTP 200 (closes DIST.17 and unblocks SEC.9 verification).
2. Enter ASC App Privacy from `asc-packaging-checklist.md` §4.2 (`DIST.7`).
3. Capture 6.9″ + 13″ shots into **official Apple bezels** (`asc-screenshot-frames.md`) and paste age-rating answers (`DIST.5` / `.6`).
4. Archive with Xcode 26 → Internal TestFlight (`DIST.4` / `TEST.2`).
5. Sign device-smoke + VoiceOver, then declare VoiceOver only on the nutrition label (`DIST.2` / `TEST.3` / `DIST.8`).

### Verification (this pass)

- `NoMarkupTests` ImageUploader PDF / DateFormatting / AppIntents / notification categories / AppConfig passkeys: **passed** (iPhone 17 Pro sim, Xcode 26.5).
- `services/notification` `TestAPNsCategory` / payload shaping: **ok**.
- Keychain tests `errSecMissingEntitlement (-34018)` when `CODE_SIGNING_ALLOWED=NO` — environmental, not a product regression.

## Findings

PASS items counted only. Remaining FAIL / RISK / GAP:

### [IOS-DIST.17] Support URL DNS does not resolve
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Provide a working Support URL (HTTP 200) and marketing presence for store listing quality.
- Evidence: `AppConfig.supportURL` is `https://no-markup.com/support`. Live DNS fails this session. In-app Account → Support is **native** (`LegalWebView` `.nativeSupport` + `mailto:support@no-markup.com`) so the binary is not a dead-end. Archive lint **warns** only. Native fallback does not satisfy the store-listing URL check.
- Remediation: Cloudflare A/AAAA for `no-markup.com`; confirm `/support` HTTP 200; enter that URL in ASC.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 10

### [IOS-SEC.9] Associated domains not proven live
- Status: RISK
- Severity: major
- Kind: recommended
- Rule: Universal Links / webcredentials configured correctly for passkeys and deep links.
- Evidence: Entitlements `applinks:` + `webcredentials:no-markup.com`. In-repo AASA `6L6565278C.com.nomarkup.app`. Production host still NXDOMAIN. Passkey client is complete but flag stays off until this is live.
- Remediation: After DNS, verify `https://no-markup.com/.well-known/apple-app-site-association` then enable server `passkeys`.
- Doc: https://developer.apple.com/documentation/authenticationservices
- Confidence: 8

### [IOS-SYS.NT.4] Push Console still unproven
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use APNs correctly; validate with Push Notifications Console.
- Evidence: HTTP/2 JWT provider in `apns.go`; client register/unregister. Packaging checklist still `[~] Founder: Optional push delivery check`.
- Remediation: Console delivery check; archived `aps-environment=production`.
- Doc: https://developer.apple.com/notifications/push-notifications-console/
- Confidence: 8

### [IOS-TEST.2] TestFlight not uploaded
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight before wide release.
- Evidence: `docs/compliance/testflight-process.md` complete; no archive/Internal group in tree.
- Remediation: Founder upload with Xcode 26.
- Doc: https://developer.apple.com/testflight/
- Confidence: 9

### [IOS-TEST.3] Device matrix unsigned
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Validate on representative devices/OS including smaller phones and current OS.
- Evidence: `device-smoke-checklist.md` M-SE / M-IPAD / M-AX5 / M-17 still `[ ]`. Partial Pro Max dogfood + sim walks.
- Remediation: Human-sign the matrix.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-DIST.2] Latest-OS QA not signed across required matrix
- Status: GAP
- Severity: major
- Kind: required
- Rule: Ensure apps work on devices running latest OS releases.
- Evidence: iOS 26.5 sim + 15 Pro Max Debug exist; required SE / iPad / Overall rows unsigned.
- Remediation: Sign latest-OS smoke on Pro Max + SE + 13″ iPad.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### [IOS-DIST.4] TestFlight process documented; no upload
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight for internal/external beta feedback.
- Evidence: Same as TEST.2.
- Remediation: App ID → archive → Internal group.
- Doc: https://developer.apple.com/testflight/
- Confidence: 9

### [IOS-DIST.5] Screenshots/keywords not in ASC
- Status: GAP
- Severity: major
- Kind: required
- Rule: Accurate product-page assets.
- Evidence: Official-bezel requirement documented (`asc-screenshot-frames.md`). No production ASC screenshot set committed. Capture harness: `ScreenshotWalkUITests`.
- Remediation: Composite official bezels; upload; enter keywords.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.6] Age rating not entered in ASC
- Status: GAP
- Severity: major
- Kind: required
- Rule: Age rating questionnaire must reflect actual content.
- Evidence: `asc-content-rating-answers.md` drafted; founder checklist `[ ]`.
- Remediation: Paste into ASC; expect 17+, not 4+.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.7] ASC privacy nutrition unfilled
- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Enter privacy practices including third-party partners (required to submit).
- Evidence: `PrivacyInfo.xcprivacy` aligned; packing table §4.2; ASC App Privacy `[~]`.
- Remediation: Founder type §4.2 into ASC (Stripe as payment partner). **Submit cannot proceed without this.**
- Doc: https://developer.apple.com/app-store/app-privacy-details/
- Confidence: 8

### [IOS-DIST.8] Accessibility nutrition withheld
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Declare only real accessibility support.
- Evidence: `accessibility-nutrition-claims.md` withholds claims until human AX. Correct non-overclaim.
- Remediation: Sign VoiceOver (app + widgets + Live Activity) then declare VoiceOver only.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

## Out-of-registry observations

### [OBS-1] Native Support vs store URL
In-app Support is closed for users. DIST.17 still fails because Apple’s check is the **public** Support URL.

### [OBS-2] Do not enable `passkeys` until AASA is live
Client adoption is PASS. Flipping the server flag now would be a dead-end (SEC.3).

### [OBS-3] ASR still NOT READY
Re-run `/app-store-compliance` before first binary submit.

## Registry coverage

| Section | PASS | FAIL | GAP | RISK | N/A |
|---------|-----:|-----:|----:|-----:|----:|
| design | 18 | 0 | 0 | 0 | 4 |
| privacy | 19 | 0 | 0 | 1 | 4 |
| system | 24 | 0 | 1 | 0 | 1 |
| intelligence | 5 | 0 | 0 | 0 | 13 |
| quality | 21 | 0 | 2 | 0 | 4 |
| games-media | 2 | 0 | 0 | 0 | 14 |
| distribution | 11 | 1 | 6 | 0 | 0 |
| **Total** | **100** | **1** | **9** | **1** | **40** |

## Done-when checklist

- [x] All applicable required items scored
- [x] Every FAIL/GAP has path evidence or explicit “not found”
- [x] Readiness label matches metric rules (major required FAIL + privacy RISK → AT RISK)
- [x] Disclaimer present

## Disclaimer

This audit maps product evidence to Apple’s published iOS developer documentation
hub and linked guidance. It is not legal advice, not App Review, and does not
guarantee App Store approval or feature eligibility. Docs are living; re-verify
against the canonical URLs before shipping. For rejection-risk policy, use
/app-store-compliance.
