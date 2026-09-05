# Device relaunch — 2026-08-05

**Device:** Tanner’s iPhone 15 Pro Max · UDID `00008130-0018493E3A41001C` · CoreDevice `AE11FA5B-E952-5732-BA5C-3819ABC95443`  
**OS:** iOS 26.5.2 (23F84) · Developer Mode **enabled** · pairing **paired**  
**Toolchain:** `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer`  
**Gateway (LAN):** `http://192.168.1.101:8081` → health **200**  
**App:** `com.nomarkup.app` Debug · version **1.0.0 (3)** · team `6L6565278C`  
**DerivedData:** `ios/DerivedDataDevice`  
**Auto-login:** `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` + `NOMARKUP_API_BASE_URL`

---

## Success table

| Step | Result | Evidence / note |
|------|--------|-----------------|
| Gateway LAN health | **PASS** | `http://192.168.1.101:8081/health` → **200** |
| Debug rebuild (`generic/platform=iOS`) | **PASS** | `** BUILD SUCCEEDED **` · signed Apple Development / team profile |
| App product | **PASS** | `ios/DerivedDataDevice/Build/Products/Debug-iphoneos/NoMarkup.app` · 16:45 PDT · bundle `com.nomarkup.app` 1.0.0 (3) |
| Device transport | **FAIL** | `tunnelState: unavailable` · `ddiServicesAvailable: false` · no USB · no `_apple-mobdev2` advert |
| Install `com.nomarkup.app` | **BLOCKED** | `CoreDeviceError 1011` / control-channel timeout (device offline) |
| Launch · customer auto-login | **BLOCKED** | same — no control channel |
| Launch · provider auto-login | **BLOCKED** | same |
| Launch · admin auto-login | **BLOCKED** | same |
| Process-alive confirm (×3) | **BLOCKED** | not reached |
| Interactive note | **N/A** | device not reachable for process/UI interaction |

**Overall:** **PARTIAL** — binary rebuilt and signed; physical install + 3-role relaunch **not completed** because CoreDevice tunnel dropped after ~16:43 PDT and never returned during this session.

---

## What ran

1. **Rebuild** under caffeinate (sources newer than prior 14:33 product):

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios
caffeinate -dims xcodebuild \
  -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination 'generic/platform=iOS' \
  -configuration Debug \
  -derivedDataPath "$(pwd)/DerivedDataDevice" \
  DEVELOPMENT_TEAM=6L6565278C \
  build
# → BUILD SUCCEEDED
```

2. **Install / launch** attempted repeatedly via `xcrun devicectl` against UDID / CoreDevice id / name. Device remained **unavailable** (`tunnelState: unavailable`). Polls ~10+ minutes; USB absent (`IOUSB` no iPhone).

3. Last known good connection (from `devicectl device info details`):  
   `lastConnectionDate: 2026-08-05 23:43:00 +0000` (16:43 PDT). Early in-session list showed **available (paired)** with DDI true; transport then failed with `NWError 60 Operation timed out`.

---

## Resume when phone is online

Unlock the phone, keep it awake, prefer **USB** (or stable Wi‑Fi + *Connect via network*), then:

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
UDID=00008130-0018493E3A41001C
APP=ios/DerivedDataDevice/Build/Products/Debug-iphoneos/NoMarkup.app
API=http://192.168.1.101:8081
PW='Password123!'   # SEED_PASSWORD

xcrun devicectl list devices   # expect: available (paired)
xcrun devicectl device install app --device "$UDID" --timeout 180 "$APP"

for role_email in \
  "customer@nomarkup.com" \
  "provider@nomarkup.com" \
  "admin@nomarkup.com"
do
  xcrun devicectl device process launch \
    --device "$UDID" --terminate-existing --timeout 60 \
    --environment-variables \
    "{\"NOMARKUP_API_BASE_URL\":\"$API\",\"NOMARKUP_UI_TEST_EMAIL\":\"$role_email\",\"NOMARKUP_UI_TEST_PASSWORD\":\"$PW\"}" \
    com.nomarkup.app
  sleep 5
  xcrun devicectl device info processes --device "$UDID" | grep -i NoMarkup || true
done
```

DEBUG auto-login is honored in `AuthViewModel` via `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD`. Admin uses the same **5-tab consumer shell** (no native admin console).

---

## Claim boundary

| Proves (this run) | Does **not** prove |
|-------------------|--------------------|
| Fresh Debug arm64 binary builds and codesigns | On-device install of this build |
| Gateway reachable on LAN from Mac | Phone process auto-login for any role |
| Device is paired + Developer Mode on (cached metadata) | Full Account-row UI walk |

Do **not** claim 3-role device relaunch green from this file until install + process-alive rows flip to PASS.

---

## Related

- [`iphone-device-dogfood-2026-08-05.md`](./iphone-device-dogfood-2026-08-05.md) — earlier same-day dogfood (prior green install when tunnel was up)  
- [`ios-ui-workflow-matrix-2026-08-05.md`](./ios-ui-workflow-matrix-2026-08-05.md) — what auto-login proves vs residual  
- [`device-e2e-results-2026-07-26.md`](./device-e2e-results-2026-07-26.md) — historical launch pattern  
