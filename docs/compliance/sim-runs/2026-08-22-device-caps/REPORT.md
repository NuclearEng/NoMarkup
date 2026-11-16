# Physical-device capabilities — Apple Pay / APNs / Face ID

**Date:** 2026-08-22  
**Device:** Tanners iphone — iPhone 15 Pro Max (`iPhone16,2`)  
**UDID:** `00008130-0018493E3A41001C`  
**CoreDevice id:** `AE11FA5B-E952-5732-BA5C-3819ABC95443`  
**OS:** iOS 26.6 (build `23G71`)  
**Xcode:** 26.5 (17F42) · `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer`  
**DerivedData:** `ios/DerivedDataDeviceCaps` (not shared with simulator)  
**Honesty bar:** Simulator cannot PASS these. No fake sheet success. No invented APNs token. No Face ID enroll. No charge.

---

## Verdict

| Check | Result | Why |
|-------|:------:|-----|
| Device online? | **PASS** | After `devicectl` launch/wake: xctrace lists the phone under **Devices** (not Offline); `devicectl` state **connected**; wired tunnel; screen backlight on. |
| `canMakePayments` | **BLOCKED** | XCTest runner never initialized. PassKit was compiled into the device tests but **not executed**. |
| APNs authorization / token registered? | **BLOCKED** | UI tests did not run. No device token observed. None invented. |
| Face ID control visible? | **BLOCKED** | Security toggle was not opened. Face ID **hardware exists** (LA `BiometryType=2` on the runner), but that is not the in-app control. Did **not** enroll. |
| Apple Pay sheet presented? | **BLOCKED** | Pay control never tapped. Sheet neither presented nor faked. |

**Overall:** physical device is connected and the UITest bundle **signed and installed**. Execution is **BLOCKED** at iOS **UI Automation mode** (user-presence Face ID / LocalAuthentication). Not a simulator skip. Not a PASS.

---

## Connectivity

### Before wake (xctrace offline, CoreDevice paired)

```text
xcrun xctrace list devices
== Devices Offline ==
Tanners iphone (26.6) (00008130-0018493E3A41001C)

xcrun devicectl list devices
Tanners iphone  …  AE11FA5B-E952-5732-BA5C-3819ABC95443  available (paired)  iPhone 15 Pro Max
```

Details (pre-wake): `bootState: booted`, `developerModeStatus: enabled`, `ddiServicesAvailable: true`, `transportType: wired`, `tunnelState: connected`, `pairingState: paired`.

Lock: `passcodeRequired: false`, `unlockedSinceBoot: true`.

### Wake

```bash
xcrun devicectl device process launch \
  --device AE11FA5B-E952-5732-BA5C-3819ABC95443 \
  --terminate-existing --activate com.nomarkup.app
# Launched application with com.nomarkup.app bundle identifier.
```

### After wake (online)

```text
xcrun xctrace list devices
== Devices ==
NuclearIsotope’s MacBook Pro (…)
Tanners iphone (26.6) (00008130-0018493E3A41001C)

xcrun devicectl list devices
Tanners iphone  …  AE11FA5B-E952-5732-BA5C-3819ABC95443  connected  iPhone 15 Pro Max

xcodebuild -showdestinations
{ platform:iOS, arch:arm64, id:00008130-0018493E3A41001C, name:Tanners iphone }
```

Post-test (still connected):

```text
Main display backlight state: backlight is on and active
Main display orientation: faceUp, … portrait
DDI: isUsable: true, contentIsCompatible: true, XCTest-24904
```

Full dumps: `connectivity-pre.txt`, `connectivity-post.txt`.

---

## Commands run

Gateway was up (`GET http://192.168.1.101:8081/health` → `{"status":"ok","version":"dev"}`) so the test runner targeted the device-reachable API base, not `127.0.0.1`.

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer

xcodebuild test \
  -project ios/NoMarkup.xcodeproj \
  -scheme NoMarkup \
  -destination 'platform=iOS,id=00008130-0018493E3A41001C' \
  -derivedDataPath ios/DerivedDataDeviceCaps \
  -only-testing:NoMarkupUITests/DeviceCapabilityUITests \
  -skip-testing:NoMarkupTests \
  -resultBundlePath docs/compliance/sim-runs/2026-08-22-device-caps/DeviceCaps.xcresult \
  TEST_RUNNER_NOMARKUP_API_BASE_URL='http://192.168.1.101:8081' \
  NOMARKUP_API_BASE_URL='http://192.168.1.101:8081'
```

Signing on the installed runner (not BLOCKED):

```text
Signing Identity:     "Apple Development: Tanner Coker (75VN6MYRJM)"
Provisioning Profile: "iOS Team Provisioning Profile: *"
                      (a65f2bf5-762c-4da4-93d7-6bdfdd140ad1)
CodeSign …/NoMarkupUITests-Runner.app
```

Retry without rebuild after SpringBoard activate — same destination / DerivedData.

---

## What actually happened on device

### Attempt 1 — Face ID cancel (`DeviceCaps-la-cancel.xcresult`)

`NoMarkupUITests-Runner` launched on the phone, then:

```text
Failed to initialize for UI testing:
  Error Domain=com.apple.LocalAuthentication Code=-2 "Canceled by user."
  NSLocalizedDescription=Authentication canceled.
  BiometryType=2

Testing failed:
  The test runner failed to initialize for UI testing.
  (Underlying Error: Authentication canceled. Canceled by user.)
```

`BiometryType=2` is Face ID. This is **XCTest enabling automation mode**, not the app’s Security toggle and not an enroll. The prompt was not completed (agent cannot look at the phone). Did **not** enroll biometrics.

### Attempt 2 — automation-mode timeout (`DeviceCaps.xcresult`)

```text
Failed to initialize for UI testing:
  Error Domain=com.apple.dt.XCTest.XCTFuture Code=1000
  "Timed out while enabling automation mode."

Testing failed:
  The test runner failed to initialize for UI testing.
  (Underlying Error: Timed out while enabling automation mode.)
```

`xcresulttool` summary: **0 passed / 0 skipped / 1 failed** (runner error, not a test assertion). Device in the bundle: Tanners iphone, iOS 26.6, UDID as above.

No `DeviceCapability:` NSLogs. None of `testApplePayRequiresPhysicalDevice`, `testAPNsDeviceTokenRequiresPhysicalDevice`, `testFaceIDHardwareRequiresPhysicalDevice` executed.

---

## Per-capability (honesty)

### `canMakePayments` — BLOCKED

On-device test **would** call `PKPaymentAuthorizationController.canMakePayments()` and log the bool. That line never ran.

- Not a simulator `XCTSkip`.
- Not asserted true as a fake sheet success.
- **Do not treat compile-of-PassKit as PASS.**

### Apple Pay sheet — BLOCKED

Test path (unexecuted): Account → `account.row.orders` → Pay with Apple Pay → if PassKitUI/Cancel appears, tap **Cancel** only. Never Pay.

Because automation mode never enabled, the sheet was **not presented**. Result is **BLOCKED**, not GAP-from-missing-Wallet and not PASS.

Merchant entitlement in the signed app remains `merchant.com.nomarkup.app` (`NoMarkup.entitlements`). That is wiring in source, not sheet evidence.

### APNs authorization / token — BLOCKED

Test path (unexecuted): Account push chrome; optionally tap **Turn on push notifications** / Enable; treat **Push notifications on** as the only UI evidence of server registration.

- No authorization status read from the running tests.
- No APNs device token captured.
- **Token is not invented.**

### Face ID control visible? — BLOCKED

Test path (unexecuted): Account → `account.row.security` → `security.requireBiometric`. Assert the **control exists**. Do not flip it on to enroll.

Runner-side `BiometryType=2` proves Face ID **hardware** is present on this iPhone 15 Pro Max. That is **not** “control visible on Security”. Completing the system Face ID prompt for automation mode is **user-only**.

---

## What is not blocked

| Item | Evidence |
|------|----------|
| Phone connected | xctrace Devices + `devicectl` **connected**, wired tunnel |
| Developer Mode + DDI | `developerModeStatus: enabled`, DDI `isUsable: true` |
| Debug signing | Apple Development: Tanner Coker (`6L6565278C` / `75VN6MYRJM`) |
| Destination | `platform=iOS,id=00008130-0018493E3A41001C` accepted |
| UITest compile for device | `SwiftDriverJobDiscovery … Compiling DeviceCapabilityUITests.swift` |
| App already on device | `com.nomarkup.app` 1.0.0 (3); `devicectl` launch succeeded |

---

## Unblock (user-only — not done here)

On the phone, while it is unlocked and face-up:

1. Look at the **Enable UI Automation** / Face ID prompt when XCTest starts (or Settings → Developer → Enable UI Automation).
2. Re-run the same `xcodebuild test` command (DerivedData already warm).
3. Do **not** complete Apple Pay; Cancel if the sheet appears. Do **not** enroll Face ID in-app.

Until that user-presence step, these three capabilities stay **BLOCKED**.

---

## Files

### Changed (working tree; not committed, not pushed)

- `ios/NoMarkupUITests/DeviceCapabilityUITests.swift` — on-device wiring only (`#if targetEnvironment(simulator)` XCTSkip kept for sim). Logs `canMakePayments`; tries Orders Pay control then **Cancel**; APNs chrome / request permission without inventing a token; Security biometric toggle existence without enrolling.
- `ios/NoMarkupTests/NotificationDeepLinkTests.swift` — hoist `await ListingEntityQuery().suggestedEntities()` out of an `XCTAssertEqual` autoclosure so the **iphoneos** unit-test target compiles (`VisualIntelligence` path). Required to reach install; not a capability claim.

### This folder

- `connectivity-pre.txt` / `connectivity-post.txt`
- `xcodebuild-errors.txt`
- `test-retry.log` / `test-sign-and-la-cancel-tail.log`
- `DeviceCaps-la-cancel.xcresult` (attempt 1)
- `DeviceCaps.xcresult` (attempt 2)
