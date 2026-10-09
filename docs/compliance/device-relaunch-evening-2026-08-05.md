# Device relaunch (evening) — 2026-08-05

**Status:** **PASS**

**Device:** Tanner’s iPhone 15 Pro Max · UDID `00008130-0018493E3A41001C` · CoreDevice `AE11FA5B-E952-5732-BA5C-3819ABC95443`  
**OS / pairing:** iOS 26.5.2 · state at launch window **available (paired)**  
**Toolchain:** `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer`  
**Gateway (LAN):** `http://192.168.1.101:8081` → health **200**  
**App:** `ios/DerivedDataDevice/Build/Products/Debug-iphoneos/NoMarkup.app` · bundle `com.nomarkup.app` · version **1.0.0 (3)** · team `6L6565278C`  
**Install path on device:** `file:///private/var/containers/Bundle/Application/DE1A7959-8EBF-4DC3-AD50-632B5246125A/NoMarkup.app/`  
**Auto-login:** `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` + `NOMARKUP_API_BASE_URL`  
**Password:** `Password123!` (seed / SEED_PASSWORD)  
**Poll:** every 60s under `caffeinate` · started **2026-08-05 17:36:45 PDT** · device available **18:33:59 PDT** · finished **18:35:41 PDT** · polls before available **58** (~57 min wait)

---

## Success table

| Step | Result | Evidence / note |
|------|--------|-----------------|
| Gateway LAN health | **PASS** | `http://192.168.1.101:8081/health` → **200** |
| App product present | **PASS** | `ios/DerivedDataDevice/.../NoMarkup.app` (pre-existing Debug) |
| Device transport | **PASS** | `devicectl list devices` → **available (paired)** at poll #58 |
| Install (1st attempt) | **FAIL** | CoreDeviceError **3002** / IXRemoteErrorDomain 6 — connection interrupted mid-install |
| Rebuild Debug (`generic/platform=iOS`) | **PASS** | `xcodebuild` → **BUILD SUCCEEDED** · same DerivedDataDevice path |
| Install (after rebuild) | **PASS** | `com.nomarkup.app` installed · databaseSequenceNumber **3356** |
| Launch · customer | **PASS** | `devicectl process launch` OK · env auto-login `customer@nomarkup.com` |
| Launch · provider | **PASS** | OK · `provider@nomarkup.com` · main process **pid 90450** |
| Launch · admin | **PASS** | OK · `admin@nomarkup.com` · main process **pid 90451** |
| Process-alive confirm | **PASS** (with note) | provider + admin: main `NoMarkup` binary; customer snapshot ~5s later only matched **widget extension** pid 90445 (launch itself succeeded) |

**Overall:** **PASS** — device came online within the 3h window; rebuild after flaky first install; all three roles launched with LAN API + seed password env.

---

## What ran

1. **Caffeinated poll** every 60s (`caffeinate -dims` on host) for device availability via `devicectl list devices` + `xctrace list devices`.
2. Device stayed **unavailable / Devices Offline** from 17:36 until **18:33:59 PDT** (poll #58), then flipped to **available (paired)**.
3. First `devicectl device install app` failed with **CoreDeviceError 3002** (remote install XPC interrupted).
4. **Rebuild** under caffeinate:

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

5. Re-install succeeded; three-role launch:

```bash
UDID=00008130-0018493E3A41001C
APP=ios/DerivedDataDevice/Build/Products/Debug-iphoneos/NoMarkup.app
API=http://192.168.1.101:8081
PW='Password123!'

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

### Install log (successful attempt)

```
18:35:12  Acquired tunnel connection to device.
18:35:12  Enabling developer disk image services.
18:35:12  Acquired usage assertion.
App installed:
• bundleID: com.nomarkup.app
• installationURL: file:///private/var/containers/Bundle/Application/DE1A7959-8EBF-4DC3-AD50-632B5246125A/NoMarkup.app/
• databaseUUID: 3F9F47D9-3A0B-4295-B18B-5E96B6239810
• databaseSequenceNumber: 3356
```

### Launch log

```
=== Launch customer (customer@nomarkup.com) ===
Launched application with com.nomarkup.app bundle identifier.
=== Launch provider (provider@nomarkup.com) ===
Launched application with com.nomarkup.app bundle identifier.
=== Launch admin (admin@nomarkup.com) ===
Launched application with com.nomarkup.app bundle identifier.
```

---

## Claim boundary

| Proves (this run) | Does **not** prove |
|-------------------|--------------------|
| Physical install of Debug 1.0.0 (3) after rebuild | Full interactive UI walk / Account-row dogfood |
| `devicectl` process launch for customer / provider / admin with seed auto-login env | Production (non-DEBUG) login UX |
| Main process alive for provider + admin immediately after launch | That customer main process stayed up (only widget seen at +5s) |
| Gateway health **200** from Mac on LAN | Phone→LAN path for every API (network on phone not instrumented here) |

Do **not** treat this as a full UI dogfood or App Store gate — only install + 3-role automated relaunch.

---

## Related

- [`device-relaunch-2026-08-05.md`](./device-relaunch-2026-08-05.md) — earlier same-day attempt (rebuild OK, install **blocked** while offline)
- [`iphone-device-dogfood-2026-08-05.md`](./iphone-device-dogfood-2026-08-05.md) — earlier same-day dogfood when tunnel was up
- Status log: `/tmp/device-relaunch-evening-status.log`  
- Rebuild log: `/tmp/device-relaunch-rebuild.log`  
- Install log: `/tmp/device-relaunch-install.log`
