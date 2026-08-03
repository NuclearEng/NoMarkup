# TestFlight process — NoMarkup iOS

**Audit IDs:** IOS-TEST.2 · IOS-DIST.4  
**Updated:** 2026-08-02  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) · [`launch-board.md`](./launch-board.md) · [`submission-blockers.md`](./submission-blockers.md) · [`app-review-notes.md`](./app-review-notes.md) · [`ios/README.md`](../../ios/README.md)

**Eng status:** Process + binary prep **done**. Everything below marked **Founder action** is portal / Team / device work only.

---

## 0. What is left for the founder (summary)

Engineering has shipped the free-tier dual-rail binary posture, purpose strings, privacy manifest, export key, review notes, and this process. **You** still must:

1. Create Apple Developer App ID + capabilities (SIWA, Push).  
2. Create ASC app record.  
3. Archive with **Xcode 26+** and upload.  
4. Answer export compliance if ASC prompts (binary already sets exempt).  
5. Create Internal TestFlight group and enable the build.  
6. Paste Review Notes + demo password (from seed — not git).  
7. Capture/upload screenshots when preparing App Store review.  
8. Keep review API + seed **up** for Apple / testers.

---

## 1. Toolchain pin (required for ASC upload)

Apple’s App Store Connect upload floor: **iOS 26 SDK** → **Xcode 26.x minimum**.

| Setting | Value |
|---------|--------|
| **Minimum Xcode for archive/upload** | **Xcode 26.0+** |
| **Pinned dogfood toolchain** | `Xcode-26.5.0` |
| **`DEVELOPER_DIR`** | `/Applications/Xcode-26.5.0.app/Contents/Developer` |
| Deployment target | iOS **17.0** |
| Swift | 6.0 (strict concurrency) |

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild -version   # must report 26.x
```

Do **not** archive with Xcode 16 / iOS 18 SDK for App Store or TestFlight — ASC will reject.

---

## 2. Version & build numbers

| Field | Policy |
|-------|--------|
| **Marketing version** | First public App Store: **`1.0.0`** |
| **Build number** | **Monotonic integer** per upload (never reuse for same version) |
| Current tree | **`1.0.0` / build `3`** (`scripts/ios-archive-lint.sh`) |

**Founder:** Each re-upload → leave marketing version, **+1** build only (in Xcode or project).

---

## 3. Pre-archive checklist

### Eng-ready (already true in tree)

- [x] Scheme **NoMarkup**, Release configuration  
- [x] Empty Info.plist `APIBaseURL` → `https://api.no-markup.com`  
- [x] Release rejects cleartext overrides (`AppConfig`)  
- [x] `PrivacyInfo.xcprivacy` in app + widget  
- [x] `ITSAppUsesNonExemptEncryption = false`  
- [x] No StoreKit IAP paywall (free-tier lock)  
- [x] Purpose strings + Face ID string present  

### Founder before archive

- [ ] `DEVELOPER_DIR` → Xcode 26.x  
- [ ] Signing: your **Team** + Distribution cert + App Store profile (or Automatic with App Store-capable team)  
- [ ] Destination: **Any iOS Device (arm64)** — not Simulator archive  
- [ ] Gateway env: `APPLE_NATIVE_CLIENT_ID=com.nomarkup.app` on the API the build will hit  
- [ ] Optional: inject `NOMARKUP_STRIPE_PUBLISHABLE_KEY` via CI/secrets for payment dogfood — never commit live keys  
- [ ] Unit tests green (optional but recommended):

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios && xcodebuild test -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:NoMarkupTests
```

---

## 4. Archive & upload — founder steps

### 4.1 Xcode UI (recommended first upload)

1. Open `ios/NoMarkup.xcodeproj` with **Xcode 26.x**.  
2. Signing & Capabilities → select **your Team**; ensure **Sign in with Apple** on the App ID.  
3. Product → Destination → **Any iOS Device (arm64)**.  
4. Product → **Archive**.  
5. Organizer → select archive → **Distribute App** → **App Store Connect** → Upload.  
6. Wait for processing. If **Missing Compliance**: answer export **exempt / HTTPS-only** (see packaging §9). Binary already has `ITSAppUsesNonExemptEncryption=false`.  
7. TestFlight tab → build **Ready to Test**.

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
```

Prefer Xcode Organizer for first uploads. **No** committed fastlane upload lane yet.

---

## 5. ASC groups — founder steps only

| Group | Purpose | When |
|-------|---------|------|
| **Internal** | Team devices (ASC users) | **First** — no external beta review |
| **External** | Broader dogfood | After internal smoke; may need Beta App Review |

**Steps:**

1. Create ASC app record for bundle `com.nomarkup.app` if missing.  
2. TestFlight → **Internal Testing** → create group e.g. `NoMarkup Internal`.  
3. Add testers (Apple IDs that are ASC users for internal).  
4. Enable the processed build for the group.  
5. External group only after internal PASS on [`device-smoke-checklist.md`](./device-smoke-checklist.md).

---

## 6. “What to Test” template (paste into TestFlight)

```text
NoMarkup iOS 1.0.0 ({BUILD}) — internal dogfood

API: https://api.no-markup.com (must be up)
Seed: customer@nomarkup.com / provider@nomarkup.com
Password: use vault / seed log (SEED_PASSWORD) — never commit to git

Please cover:
1) Cold launch → native login (TabView shell, not a website)
2) Marketplace browse + listing detail
3) Jobs browse + job detail
4) Sign in (email or SIWA) → Account legal links + Delete Account UI
   (do not delete shared seed accounts)
5) Plan limits: free-tier only — no IAP paywall
6) Place-bid / Buy now only on staging you own (Stripe)
7) Notifications pre-prompt after bid/watch if shown
8) Accessibility: largest text — money labels readable
9) Device matrix: SE, Pro Max class, any iPad

Report: step #, device, OS, screenshot, expected vs actual.
Regulated rails (BNPL, insurance, advances, instant payout) should stay
server-flag OFF unless intentional.
```

Full App Review notes: [`app-review-notes.md`](./app-review-notes.md).

---

## 7. Crash triage

| Source | Action |
|--------|--------|
| TestFlight / Organizer crashes | Symbolicate with matching dSYM; file issue with build # |
| Repro on cold launch / login | **Block** external group and public submit |
| Known non-blockers | Missing Stripe `pk_` → “not configured”; SIWA fails without App ID keys |

After fix: **new build number**, re-upload, re-enable group.

---

## 8. Screenshot walk (optional automation)

See [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md).

```bash
# Requires live API + NOMARKUP_UI_TEST_PASSWORD from seed
cd ios
xcodebuild test -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro Max' \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests
```

---

## 9. Gate status

| Item | Status |
|------|--------|
| Process doc (this file) | **Done (eng)** |
| ASC record + internal group | **Open (founder)** |
| First archive uploaded | **Open (founder)** |
| Human device smoke signed | **Open (founder/QA)** |
| App Store Review submit | **Open (founder)** after internal smoke + media + notes |

**Do not** mark TestFlight “shipped” until an internal build is on a physical device and smoke is signed.

---

*Owner: iOS launch readiness. Eng packaging complete 2026-08-02; remaining steps are founder-only.*
