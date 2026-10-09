# Device SOTA relaunch — 2026-08-05 (18:45 PDT)

**Status:** **PASS**

**Device:** Tanner’s iPhone 15 Pro Max · UDID `00008130-0018493E3A41001C` · CoreDevice `AE11FA5B-E952-5732-BA5C-3819ABC95443`  
**OS / pairing:** iOS 26.5.2 (23F84) · **available (paired)** · Developer Mode **enabled** · DDI **true** · bootState **booted**  
**Toolchain:** `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer` · Xcode 26.5 (17F42)  
**Gateway (LAN):** `http://192.168.1.101:8081` → health **200** `{"status":"ok","version":"dev"}`  
**App:** `ios/DerivedDataDevice/Build/Products/Debug-iphoneos/NoMarkup.app` · bundle `com.nomarkup.app` · version **1.0.0 (3)** · team `6L6565278C` · arm64 · Apple Development (Tanner Coker)  
**Binary mtime:** 2026-08-05 **18:35:10 PDT** (evening rebuild; newer than newest Swift source — **no rebuild required**)  
**Install path on device:** `file:///private/var/containers/Bundle/Application/0C042ED8-DC82-4008-8C92-573F97488EC2/NoMarkup.app/`  
**Auto-login:** `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` + `NOMARKUP_API_BASE_URL`  
**Password:** `Password123!` (seed / SEED_PASSWORD)  
**Window:** install **18:45:35** · customer **18:45:39** · provider **18:45:45** · admin **18:45:51** · done **18:45:57** PDT  
**Full log:** `/tmp/device-sota-relaunch-2026-08-05.log`

---

## PASS table

| Step | Result | Evidence / note |
|------|--------|-----------------|
| Device available | **PASS** | `devicectl list devices` → **available (paired)** · tunnel + DDI up · lastConnection ~01:45 UTC |
| Gateway LAN health | **PASS** | `GET http://192.168.1.101:8081/health` → **200** |
| Best Debug product | **PASS** | Pre-built `Debug-iphoneos/NoMarkup.app` 1.0.0 (3); sources older than binary → skip rebuild |
| Install | **PASS** | `devicectl device install app` OK · databaseSequenceNumber **3364** · install exit 0 |
| Launch · customer auto-login | **PASS** | `customer@nomarkup.com` · launch OK · main process **pid 90551** |
| Launch · provider auto-login | **PASS** | `provider@nomarkup.com` · launch OK · main process **pid 90555** · 5s after customer |
| Launch · admin auto-login | **PASS** | `admin@nomarkup.com` · launch OK · main process **pid 90556** · 5s after provider |
| Process-alive confirm (×3) | **PASS** | Each role: main `…/NoMarkup.app/NoMarkup` binary present ~5s post-launch |

**Overall:** **PASS** — device online; best Debug app installed without rebuild; all three seed roles launched with LAN API + auto-login env; main process alive for customer, provider, and admin.

---

## What ran

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
UDID=00008130-0018493E3A41001C
APP=ios/DerivedDataDevice/Build/Products/Debug-iphoneos/NoMarkup.app
API=http://192.168.1.101:8081
PW='Password123!'

xcrun devicectl list devices   # available (paired)
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

DEBUG auto-login is honored in `AuthViewModel.applyLaunchTestCredentialsIfNeeded()` via `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD`. Admin uses the same **5-tab consumer shell** (no native admin console).

### Install log

```
18:45:35  Acquired tunnel connection to device.
18:45:35  Enabling developer disk image services.
18:45:35  Acquired usage assertion.
App installed:
• bundleID: com.nomarkup.app
• installationURL: file:///private/var/containers/Bundle/Application/0C042ED8-DC82-4008-8C92-573F97488EC2/NoMarkup.app/
• databaseUUID: 3F9F47D9-3A0B-4295-B18B-5E96B6239810
• databaseSequenceNumber: 3364
```

### Launch log

```
=== Launch customer@nomarkup.com ===
Launched application with com.nomarkup.app bundle identifier.
90551   …/NoMarkup.app/NoMarkup

=== Launch provider@nomarkup.com ===
Launched application with com.nomarkup.app bundle identifier.
90555   …/NoMarkup.app/NoMarkup

=== Launch admin@nomarkup.com ===
Launched application with com.nomarkup.app bundle identifier.
90556   …/NoMarkup.app/NoMarkup
```

---

## Claim boundary

| Proves (this run) | Does **not** prove |
|-------------------|--------------------|
| Physical install of Debug 1.0.0 (3) on unlocked paired device | Full interactive UI walk / Account-row dogfood |
| `devicectl` process launch for customer / provider / admin with seed auto-login env | Production (non-DEBUG) login UX |
| Main process alive for **all three** roles ~5s after launch | That auto-login network call succeeded on-device (only process shell observed) |
| Gateway health **200** from Mac on LAN | Phone→LAN path for every API (network on phone not instrumented here) |

Do **not** treat this as a full UI dogfood or App Store gate — only install + 3-role automated relaunch with process-alive checks.

---

## Related

- [`device-relaunch-evening-2026-08-05.md`](./device-relaunch-evening-2026-08-05.md) — earlier same evening (rebuild + PASS; customer process-alive note weaker)
- [`device-relaunch-2026-08-05.md`](./device-relaunch-2026-08-05.md) — afternoon attempt (rebuild OK, install **blocked** while offline)
- [`iphone-device-dogfood-2026-08-05.md`](./iphone-device-dogfood-2026-08-05.md) — earlier same-day dogfood when tunnel was up
- [`ios-ui-workflow-matrix-2026-08-05.md`](./ios-ui-workflow-matrix-2026-08-05.md) — what auto-login proves vs residual
- Status log: `/tmp/device-sota-relaunch-2026-08-05.log`
