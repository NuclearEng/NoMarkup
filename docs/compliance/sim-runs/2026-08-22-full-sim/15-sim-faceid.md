# Simulator Face ID enroll — iPhone 17e (2026-08-22)

**Not physical Face ID.** No Secure Enclave. No claim that a real iPhone enrolled a face. This is the Xcode Simulator mock (Features → Face ID), probed on **iPhone 17e** only.

Do **not commit**. Did **not erase** the simulator.

| Field | Value |
|-------|--------|
| Date | 2026-08-22 |
| Xcode | 26.5 (17F42) · `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer` |
| Runtime | iOS 26.5 (`23F77`) |
| Device | iPhone 17e `5B84AFEE-78CD-4427-A536-95EE91D81220` (Booted). Avoided FullSim / B / C. |
| Host process | `Simulator.app` (`-CurrentDeviceUDID` was 17 Pro; 17e is a separate Window) |
| App | `com.nomarkup.app` (`BiometricGate` / `LAContext`) |

---

## Verdict

| Check | Result |
|-------|--------|
| Official `simctl` enroll subcommand | **None.** `xcrun simctl help` has no `bio` / `face` / `enroll`. `simctl ui` is appearance / contrast / content size only. |
| Official `devicectl` enroll (Xcode 26.5) | **None.** `devicectl device` has copy/info/install/notification/orientation/process/reboot/sysdiagnose/uninstall. No `settings biometrics`. (`devicectl list devices` lists the physical phone only, not sims.) |
| `com.apple.BiometricKit` defaults domain | **Does not exist** on this sim. `com.apple.biomed` is only `LastCombinedBuild`. |
| Unofficial CLI (`notifyutil`) | **Works.** `enrollmentChanged` 0 → 1. |
| GUI: Features → Face ID → Enrolled | **Exists** (toggle). Confirmed via AppleScript + screenshot. |
| `LAContext` after enroll | **Would work on this sim.** Spawned probe: `biometryType=2` (Face ID), `canEvaluateBiometrics=true`, `canEvaluateDeviceOwner=true`. Did **not** call `evaluatePolicy` (no Matching Face sheet). |

**Honesty:** Simulator Face ID is a Darwin-notification mock. Matching Face / Non-matching Face are menu-driven fakes. Physical-device Face ID remains a residual (`docs/compliance/sim-runs/2026-08-22-device-caps/REPORT.md`).

---

## 1. `simctl spawn` + `notifyutil` (worked)

Guest `notifyutil` exists and is spawnable:

```text
xcrun simctl spawn 5B84AFEE-78CD-4427-A536-95EE91D81220 notifyutil -h
# usage: notifyutil [-q] [-v] …  -p key  -g key  -s key val
```

Pre-enroll:

```text
xcrun simctl spawn 5B84AFEE-78CD-4427-A536-95EE91D81220 notifyutil -g com.apple.BiometricKit.enrollmentChanged
# com.apple.BiometricKit.enrollmentChanged 0
```

Classic AppleSimulatorUtils pair (set + post):

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
UDID=5B84AFEE-78CD-4427-A536-95EE91D81220

xcrun simctl spawn "$UDID" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn "$UDID" notifyutil -p com.apple.BiometricKit.enrollmentChanged
```

Post-enroll (17e only; sibling booted sims stayed `0`):

```text
5B84AFEE-…81220 (17e)     enrollmentChanged 1
7F123C44-…8510  (17 Pro)  enrollmentChanged 0
503E262C-…539E  (17 Pro Max) enrollmentChanged 0
B3CA7DF9-…5D6D  (17)      enrollmentChanged 0
```

Related keys (`enrollmentState`, `pearl.enrolled`, `enrolled`, `Pearl.enrollmentChanged`, `springboard.biometricEnrollmentChanged`) stayed **0** after `-s 1`/`-p` — they have no live registration, so set is a no-op. Only `com.apple.BiometricKit.enrollmentChanged` is the live enroll bit.

`--` `notifyutil -s` only sticks when something is already registered for the key. `enrollmentChanged` returned `0` (not empty) **before** set, so BiometricKit was listening.

### Biometric defaults (do not exist as an enroll switch)

```text
xcrun simctl spawn "$UDID" defaults read com.apple.BiometricKit
# Domain com.apple.BiometricKit does not exist

xcrun simctl spawn "$UDID" defaults read com.apple.biomed
# { LastCombinedBuild = "25F84-23F77"; }

# host
defaults read com.apple.iphonesimulator | grep -iE 'bio|face|enroll'
# (no keys)
```

No `defaults write` enroll path was found. Did not invent one.

---

## 2. AppleScript — Features → Face ID → Enrolled (worked; is a toggle)

Simulator 26.5 **does** have the GUI. Menu bar: `Features` (not Hardware / I/O). Submenu:

| Item | Role |
|------|------|
| Enrolled | Toggle enroll (checkmark when on) |
| Matching Face | Fake a successful `evaluatePolicy` |
| Non-matching Face | Fake a failed `evaluatePolicy` |

Read-only dump (after notifyutil set the bit; 17e window fronted):

```applescript
tell application "System Events"
  tell process "Simulator"
    -- Window → "iPhone 17e – iOS 26.5"
    -- Features → Face ID → Enrolled
    -- AXMenuItemMarkChar was "✓" with notifyutil state 1
  end tell
end tell
```

**Gotcha:** `click menu item "Enrolled"` **toggles**. A second click while already enrolled set `enrollmentChanged` back to **0** and cleared the checkmark. Re-enrolled with the notifyutil pair; left it enrolled (`1`). Did not click Enrolled again.

Screenshot evidence (desktop captures; 17e window titled **iPhone 17e iOS 26.5**):

- `15-sim-faceid-submenu.png` — **✓ Enrolled** visible
- `15-sim-faceid-enrolled-checkmark.png` — menu open after re-enroll (Enrolled highlighted)
- `15-sim-faceid-17e-after-reenroll.png` — `simctl io` LCD of 17e (app chrome; enroll is not an in-app UI)

---

## 3. Official CLI on Xcode 26.5 — none

```text
xcrun simctl help          # no bio/face/enroll
xcrun simctl help ui       # appearance | increase_contrast | content_size
xcrun simctl help spawn    # spawn a guest executable; not an enroll verb

xcrun devicectl help device
# copy, info, install, notification, orientation, process, reboot,
# sysdiagnose, uninstall
# no: settings biometrics / simulate biometrics
```

Xcode **27** Device Hub is documented as adding `devicectl device settings biometrics --enable` and `device simulate biometrics`. That is **not** this toolchain (26.5). Do not copy those commands into 26.5 scripts.

Simulator 26.5 therefore has:

- **No** first-party `simctl`/`devicectl` enroll command
- **Yes** unofficial `notifyutil` Darwin-notify enroll (above)
- **Yes** GUI Features → Face ID → Enrolled

---

## 4. `LAContext` after enroll (simulator mock)

Host-compiled `iphonesimulator` probe, spawned on 17e (not the NoMarkup UI; same APIs as `BiometricGate`):

```swift
import LocalAuthentication
let ctx = LAContext()
var err: NSError?
_ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
// also .deviceOwnerAuthentication
```

```bash
xcrun --sdk iphonesimulator swiftc \
  -target arm64-apple-ios26.5-simulator \
  -framework LocalAuthentication -o /tmp/la_probe /tmp/la_probe.swift
xcrun simctl spawn 5B84AFEE-78CD-4427-A536-95EE91D81220 /tmp/la_probe
```

Output (after `enrollmentChanged 1`):

```text
biometryType=2
canEvaluateBiometrics=true
canEvaluateDeviceOwner=true
```

`LABiometryType.faceID.rawValue == 2`. So on this **simulator**, `BiometricGate.biometryDisplayName` would be `"Face ID"` and `canAuthenticate` would be `true`. `evaluatePolicy` was **not** invoked; Matching Face was **not** sent. A live prompt would still be the Simulator sheet, dismissed with Features → Face ID → Matching Face (`notifyutil -p com.apple.BiometricKit_Sim.pearl.match` is the historical pair — not run this pass).

`BiometricGate.authenticate` uses `.deviceOwnerAuthentication` (biometry **or** passcode) and degrades to `true` when policy cannot be evaluated (bare sim / no passcode). After this enroll, the guard would **not** take that skip path — it would present the mock Face ID UI.

---

## 5. What this is not

- Not a physical iPhone Face ID enrollment. Not Secure Enclave. Not a lab biometric.
- Not Apple Pay / passcode / UI Automation enable.
- Did not erase `5B84AFEE-78CD-4427-A536-95EE91D81220`. Device still **Booted**.
- Did not enroll the other booted sims (17 / 17 Pro / 17 Pro Max remain `enrollmentChanged 0`).
- Did not flip the in-app Security toggle (`com.nomarkup.security.requireBiometricForSensitive`).

Left enrolled on 17e so a later `LAContext` / UITest pass can use Matching Face. Unenroll:

```bash
xcrun simctl spawn 5B84AFEE-78CD-4427-A536-95EE91D81220 notifyutil \
  -s com.apple.BiometricKit.enrollmentChanged 0
xcrun simctl spawn 5B84AFEE-78CD-4427-A536-95EE91D81220 notifyutil \
  -p com.apple.BiometricKit.enrollmentChanged
# or click Features → Face ID → Enrolled once while it is checked
```
