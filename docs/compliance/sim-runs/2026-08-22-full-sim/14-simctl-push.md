# Simulator APNs residual — `simctl push` — 2026-08-22

Close the **Simulator-reachable** slice of APNs: inject a remote-notification JSON via `xcrun simctl push`. **Not** a real APNs device token. **Not** Apple Push Notification service, sandbox or production. **Not** `POST /api/v1/notifications/devices`.

**No commit. No reinstall. Did not touch `DerivedDataFullSim`, `DerivedDataFullSimB`, or `DerivedDataFullSimC`.**

| Field | Value |
|--------|--------|
| Sim | iPhone 17e `5B84AFEE-78CD-4427-A536-95EE91D81220` / iOS 26.5 (23F77) arm64 — already Booted |
| Occupied (avoided) | 17 Pro `DerivedDataFullSim` · 17 Pro Max `DerivedDataFullSimB` · 17 `DerivedDataFullSimC` |
| Xcode | 26.5 (17F42) · `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer` |
| Bundle | `com.nomarkup.app` (already installed; launched, not rebuilt) |
| API | `http://127.0.0.1:8081` health **200** (app chrome shows `192.168.1.101:8081`) |
| Payload | [`14-simctl-push-payload.json`](14-simctl-push-payload.json) (278 bytes, `< 4096`) |
| Stdout | [`14-simctl-push-stdout.txt`](14-simctl-push-stdout.txt) |
| Shots | [`14-simctl-push-before.png`](14-simctl-push-before.png) · [`14-simctl-push-after.png`](14-simctl-push-after.png) |
| Inventory | [`00-inventory.md`](00-inventory.md) / [`09-remaining-inventory.md`](09-remaining-inventory.md) — APNs token = **sim N/A** / **device** |

---

## Verdict

| Claim | Status |
|-------|--------|
| `xcrun simctl push` accepted (exit **0**) | **PASS** |
| stdout | `Notification sent to 'com.nomarkup.app'` |
| Real APNs device token registered with Apple / our API | **NO — not proven, not attempted** |
| Physical-device residual (`testAPNsDeviceTokenRequiresPhysicalDevice`) | **still open** — Simulator cannot mint a token |

**PASS here = CoreSimulator delivered a simulated remote-notification payload to the running bundle. It does not close the physical-device APNs residual.**

---

## Command (this run)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
UDID=5B84AFEE-78CD-4427-A536-95EE91D81220

# already Booted; already installed — launch only
xcrun simctl launch "$UDID" com.nomarkup.app
# → com.nomarkup.app: 81145   (UIKitApplication:com.nomarkup.app[dd53][rb-legacy])

xcrun simctl push "$UDID" com.nomarkup.app \
  docs/compliance/sim-runs/2026-08-22-full-sim/14-simctl-push-payload.json
# stdout: Notification sent to 'com.nomarkup.app'
# exit: 0   (re-issued once to confirm; both times identical)
```

UTC: **2026-08-22T21:42:58Z** (first push, with before/after shots). Second confirm immediately after, same stdout / exit 0.

---

## Payload

Top-level object, required `aps` key, plus the app's existing `action_url` userInfo key (`PushRegistration.actionURL(from:)` / `DeepLinkRouter.route(fromActionString: "/jobs")` → `.jobsBrowse`). Category `new_message` is in `PushRegistration.registeredCategoryIdentifiers`.

```json
{
  "aps": {
    "alert": {
      "title": "NoMarkup (simctl)",
      "body": "Simulated APNs payload — jobs browse. Not a real device token."
    },
    "sound": "default",
    "badge": 1,
    "category": "new_message"
  },
  "action_url": "/jobs",
  "type": "new_message"
}
```

`simctl help push`: application remote push only; VoIP / Complication / File Provider **not** supported. Bundle id on the CLI overrides any `Simulator Target Bundle` key (none used).

---

## Screenshot honesty

App was in the **Sign in** shell (no session). Before (2:42) and after (2:43) are the same login form. **No banner is visible** in `14-simctl-push-after.png`. That is expected on this surface:

- Notification authorization is likely `.notDetermined` / not granted (push chrome lives under Account after sign-in).
- Foreground presentation is gated on `UNUserNotificationCenterDelegate.willPresent` **and** authorization.
- `simctl push` still reports delivery to the bundle regardless of whether SpringBoard draws a banner.

Screenshot is optional evidence of *which screen was up*, not of a visible alert. Stdout is the gate.

Did **not** tap a banner / VIEW action / deep-link into Jobs. Unit coverage for `action_url` → `.jobsBrowse` already exists (`NotificationDeepLinkTests` / `NotificationActionBranchTests` — [`12-widget-intents.md`](12-widget-intents.md) 75/75).

---

## Honesty bar — what this is **not**

- **Not a real APNs device token.** Simulator never talks to `api.push.apple.com`. No hex token, no `didRegisterForRemoteNotificationsWithDeviceToken`, no `POST /api/v1/notifications/devices`.
- **Not** production `aps-environment`. Archive export still owns that entitlement for a device/TestFlight build.
- **Not** permission grant / Settings → Notifications UI. `testAPNsDeviceTokenRequiresPhysicalDevice` remains `XCTSkip("APNs device token requires a physical device")`.
- **Not** a signed-in session, so in-app push chrome (`Push notifications on`, server registration) was not walked.
- **Not** proof that tapping the simulated notification routes to `/jobs`. Parse/route is unit-tested; this probe only injected the payload.

Still founder / device: DEPLOY, Stripe live, DNS, ASC, Apple Pay sheet, Face ID enroll, camera **source**, and a **physical iPhone** APNs token.

---

## Rerun

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
UDID=5B84AFEE-78CD-4427-A536-95EE91D81220
xcrun simctl push "$UDID" com.nomarkup.app \
  docs/compliance/sim-runs/2026-08-22-full-sim/14-simctl-push-payload.json
```
