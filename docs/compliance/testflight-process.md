# TestFlight process — NoMarkup iOS

**Audit IDs:** IOS-TEST.2 · IOS-DIST.4  
**Updated:** 2026-07-27  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) · [`launch-board.md`](./launch-board.md) · [`device-smoke-checklist.md`](./device-smoke-checklist.md) · [`ios/README.md`](../../ios/README.md)

This is the **process** for internal (and later external) TestFlight. It does **not** claim a live ASC app record or beta group exists until ops creates them.

---

## 1. Toolchain pin (required for ASC upload)

Apple’s App Store Connect upload floor (as of 2026-04-28 hub guidance): **iOS 26 SDK** → **Xcode 26.x minimum**.

| Setting | Value |
|---------|--------|
| **Minimum Xcode for archive/upload** | **Xcode 26.0+** |
| **Pinned dogfood toolchain** | `Xcode-26.5.0` |
| **`DEVELOPER_DIR`** | `/Applications/Xcode-26.5.0.app/Contents/Developer` |
| Deployment target | iOS **17.0** |
| Swift | 6.0 (strict concurrency) |

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
# or: sudo xcode-select -s /Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild -version   # must report 26.x
```

Do **not** archive with Xcode 16 / iOS 18 SDK for App Store or TestFlight submission — ASC will reject.

---

## 2. Version & build numbers

| Field | Policy |
|-------|--------|
| **Marketing version** (`CFBundleShortVersionString` / `MARKETING_VERSION`) | First public App Store: **`1.0.0`**. Local/TestFlight may ship `0.1.x` while iterating; **bump to 1.0.0 before first public review**. |
| **Build number** (`CFBundleVersion` / `CURRENT_PROJECT_VERSION`) | **Monotonic integer** per upload to ASC (never reuse a build for the same version). Increment on every archive that will be uploaded. |
| Who bumps | Engineer preparing the archive; note build in TestFlight “What to Test” and in device-smoke sign-off. |

Current tree (verified 2026-07-27): **`1.0.0` / build `3`** across all 8 build configurations (`MARKETING_VERSION = 1.0.0`, `CURRENT_PROJECT_VERSION = 3` — lint-checked by `scripts/ios-archive-lint.sh`).

1. First **public** candidate archives as `1.0.0` build `3` (or the next free integer if a build 3 was already uploaded).  
2. Each re-upload: leave marketing, **+1** build only.  
3. Hotfix after 1.0.0: either `1.0.1` + new build, or `1.0.0` + higher build only if notes allow.

---

## 3. Pre-archive checklist (binary truth)

- [ ] `DEVELOPER_DIR` points at Xcode 26.x  
- [ ] Scheme **NoMarkup**, configuration **Release**  
- [ ] `AppConfig` resolves **HTTPS** for Release (empty Info.plist `APIBaseURL` → `https://api.no-markup.com`)  
- [ ] Unit tests green: `xcodebuild test -only-testing:NoMarkupTests` (see §7)  
- [ ] No secrets in Info.plist (Stripe/Google keys empty or injected via CI secrets — never commit live keys)  
- [ ] `PrivacyInfo.xcprivacy` present in **both** targets (app `ios/NoMarkup/` + widget `ios/NoMarkupWidget/`)  
- [ ] Signing: Distribution cert + App Store profile (or Automatic with team that has App Store capability)  
- [ ] Destination: **Any iOS Device (arm64)** — not a simulator archive for TestFlight  

---

## 4. Archive & upload (Xcode 26+)

### 4.1 Xcode UI

1. Open `ios/NoMarkup.xcodeproj` with Xcode 26.x.  
2. Product → Destination → **Any iOS Device (arm64)**.  
3. Product → **Archive**.  
4. Organizer → select archive → **Distribute App** → **App Store Connect** → Upload.  
5. Leave “Manage Version and Build Number” off if you already set them in the project; otherwise allow Xcode to bump only when you intend it.  
6. Wait for processing email / ASC **TestFlight** tab → build becomes **Ready to Test** (or **Missing Compliance** — answer export per packaging checklist §9; binary already sets `ITSAppUsesNonExemptEncryption=false`).

### 4.2 CLI sketch (optional)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios

xcodebuild archive \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -configuration Release \
  -archivePath /tmp/NoMarkup.xcarchive \
  -destination 'generic/platform=iOS'

# Export / upload via Organizer or xcodebuild -exportArchive + altool/notary as team prefers.
# Prefer Xcode Organizer for first uploads until a CI lane is provisioned.
```

There is **no** committed fastlane lane yet — do not claim automated CI upload.

---

## 5. ASC groups

| Group | Purpose | When |
|-------|---------|------|
| **Internal** | Team + founder devices (up to 100 App Store Connect users) | **First** — create before first binary. No external beta review. |
| **External** (optional) | Broader dogfood | After internal smoke; may require Beta App Review. |

**Ops steps (human):**

1. Create ASC app record (bundle `com.nomarkup.app`) if missing — see packaging checklist §10.1.  
2. TestFlight → **Internal Testing** → create group e.g. `NoMarkup Internal`.  
3. Add testers (Apple IDs that are ASC users for internal).  
4. Enable the processed build for the group.  
5. External group only after internal PASS on `device-smoke-checklist.md`.

---

## 6. “What to Test” template

Paste into TestFlight build notes (adapt version/build):

```text
NoMarkup iOS {MARKETING} ({BUILD}) — internal dogfood

API: https://api.no-markup.com (must be up)
Seed: customer@nomarkup.com / provider@nomarkup.com (password in 1Password / seed log — never in git)

Please cover:
1) Cold launch → native login (not a website shell)
2) Marketplace browse + listing detail
3) Jobs browse + job detail
4) Sign in (email or SIWA) → Account legal links + Delete Account UI (do not delete seed)
5) Place-bid UI (error OK if not provider-eligible)
6) Buy now / Orders pay only on staging you own (Stripe)
7) Notifications: after first bid/watch, confirm pre-prompt → system dialog; tap a push if server can send
8) Accessibility: Settings → Accessibility → Display & Text Size → largest; check money labels don’t hard-clip
9) Device matrix row: your model (prefer SE 3rd gen, Pro Max class, and any iPad)

Report: step #, device, OS, screenshot, expected vs actual.
Regulated rails (BNPL, insurance, advances, instant payout) should stay off unless intentional.
```

---

## 7. Crash triage

| Source | Action |
|--------|--------|
| TestFlight / Xcode Organizer crashes | Symbolicate with matching archive dSYM; file issue with build # + stack. |
| MetricKit / device logs | Attach to same issue; strip PII from screenshots. |
| Repro gate | If crash on cold launch or login → **block** external group and public submit. |
| Known non-blockers | Missing Stripe `pk_` → “not configured” (expected without ops). SIWA fails without App ID / keys (document). |

After a crash fix: **new build number**, re-upload, re-enable group, note “fixes crash in build N”.

---

## 8. Unit tests before upload (TEST.1)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios
xcodebuild test \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:NoMarkupTests
```

Target: `ios/NoMarkupTests/` (MoneyFormat, AppConfig HTTPS resolution, NotificationDeepLink / DeepLinkRouter, ImageUploader sniff/downsample helpers, CatalogDateFormat). UI tests (`NoMarkupUITests`) are optional for archive gate (need seed creds).

---

## 9. Gate on launch board

| Item | Status |
|------|--------|
| Process doc (this file) | **Done** |
| ASC record + internal group | **Open (ops)** |
| First archive uploaded | **Open (ops)** |
| Human device smoke signed | **Open (human)** — see device-smoke checklist |

**Do not** mark TestFlight “shipped” until an internal build is installed on a physical device and smoke is signed.

---

*Owner: iOS launch readiness. Update when ASC groups or CI upload land.*
