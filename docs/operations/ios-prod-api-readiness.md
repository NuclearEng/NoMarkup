# iOS production API readiness (capital-light / App Store)

**Date:** 2026-08-05  
**Scope:** Archive / App Store binary must resolve **HTTPS-only** production API; Debug dogfood may use scheme env.  
**Gate:** `scripts/ios-archive-lint.sh` (Archive scheme PreAction + `make ios-archive`).

## Status

| Check | Status | Evidence |
|-------|--------|----------|
| **Production API base** | **PASS** | `AppConfig.productionAPIBaseURL` = `https://api.no-markup.com` (`ios/NoMarkup/Core/AppConfig.swift`) |
| **Info.plist `APIBaseURL`** | **PASS** | Empty string — Release falls through to production HTTPS. No committed LAN URL. |
| **ATS (shipping plist)** | **PASS** | No `NSAppTransportSecurity` dict. No `NSAllowsArbitraryLoads`. No `NSAllowsLocalNetworking`. Default ATS = HTTPS-only. |
| **Release cleartext rejection** | **PASS** | `allowCleartext = false` when `!DEBUG`; non-https env/plist skipped; belt-and-suspenders force `productionAPIBaseURL` if resolved base is not https. Unit tests in `AppConfigTests`. |
| **Scheme env Debug-only** | **PASS** | `NOMARKUP_API_BASE_URL` only under **LaunchAction** (`buildConfiguration = Debug`). **ProfileAction** `shouldUseLaunchSchemeArgsEnv = NO` + Release. **ArchiveAction** uses Release (no launch env). |
| **Archive lint** | **PASS** | Empty/https `APIBaseURL`; absent `NSAppTransportSecurity`; Xcode 26+; PrivacyInfo; export-compliance key. |

**Overall:** **READY** for capital-light production API URL in Release/Archive. Ship gate remains founder ASC / device smoke / host uptime (not config).

## Resolution order (`AppConfig.apiBaseURL`)

1. Process env `NOMARKUP_API_BASE_URL` — **Release rejects non-https**
2. **DEBUG + Simulator only:** `http://127.0.0.1:8081`
3. Info.plist `APIBaseURL` when non-empty — **Release rejects non-https**
4. **Production:** `https://api.no-markup.com`

## Dogfood (Debug only — preserved)

| Mode | How |
|------|-----|
| Simulator | Automatic `http://127.0.0.1:8081` when env/plist empty (`DEBUG` + simulator). |
| Physical device / LAN | Shared scheme LaunchAction env `NOMARKUP_API_BASE_URL` (e.g. LAN gateway). Adjust host to your network; **do not** put LAN URLs in Info.plist. |
| Prefer for device | HTTPS staging / tunnel — cleartext LAN may still be blocked by default ATS (no shipping exception by design). |

**Do not** re-add ATS exceptions to the shared `Info.plist` for dogfood. That would ship in Archive.

## What was verified (no Release-unsafe settings found)

- Committed `ios/NoMarkup/Info.plist`: `APIBaseURL` empty; no ATS exception keys.
- Shared scheme: cleartext env is Launch/Debug only; Profile does not inherit; Archive is Release.
- `AppConfig` production constant and Release fail-closed paths present and tested.

## Residual ops (not eng config)

- Production host `https://api.no-markup.com` must be reachable for App Review (ASR 2.1).
- First TestFlight / ASC upload remains founder process (`docs/compliance/testflight-process.md`).
- APNs / AASA / privacy nutrition labels: founder residual (see iOS developer audit remediation).
