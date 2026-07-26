# Device smoke checklist — NoMarkup iOS

**Program:** Stage C residual (B6 ops)  
**Related:** [`launch-board.md`](./launch-board.md) · [`app-store-review-2026-07-26-launch.md`](./app-store-review-2026-07-26-launch.md) · [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) · [`ios/README.md`](../../ios/README.md)

Manual **Simulator** (or device) pass against a reachable gateway + seed.  
Check **Pass** only after a human executes the step. Leave **Fail** notes specific enough to file a fix.

---

## Preflight

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| P1 | Gateway up (local Docker/`make` or staging). Default DEBUG API: `http://localhost:8080` (see `AppConfig`) | [ ] | [ ] | |
| P2 | DB seed applied (`customer@` / `provider@` + `SEED_PASSWORD` if auth paths used) | [ ] | [ ] | |
| P3 | Open project: `open ios/NoMarkup.xcodeproj` | [ ] | [ ] | |
| P4 | Run **NoMarkup** scheme on **iPhone 16** Simulator (⌘R or `xcodebuild` + install) | [ ] | [ ] | Destination: `platform=iOS Simulator,name=iPhone 16` |

### Build (optional CLI sanity)

```bash
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-26.5.0.app/Contents/Developer}"
cd ios
xcodebuild \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -configuration Debug \
  build
```

Then run from Xcode (**⌘R**) on iPhone 16.

---

## Smoke matrix

| # | Scenario | Expected | Pass | Fail | Notes |
|---|----------|----------|:----:|:----:|-------|
| 1 | **Cold launch** → Login or scaffold | App shows native `LoginView` (email/password + SIWA + “Browse native chrome (scaffold)”). **Not** a WKWebView of the website. | [ ] | [ ] | Guideline **4.2** |
| 2 | **Health check on Home** | Enter main tabs (sign in **or** scaffold). **Home** → Gateway section → **Refresh status**. Green check when API reachable; red + error copy when not. Live catalog counts or graceful offline message. | [ ] | [ ] | |
| 3 | **Launch gates / hard-off flags** | Regulated rails stay **off** in this binary (`FeatureFlags.iOSHardOffKeys`): `customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `lead_gen`, `instant_payout`. **Home** “Product rails” (or Launch gates / debug UI if present) must not offer BNPL, advances, insurance purchase, legal marketplace, lead-gen, or instant payout CTAs. | [ ] | [ ] | Code hard-off is authoritative even if server flags are true |
| 4 | **Marketplace** loads list | **Marketplace** tab: list of active listings **or** empty state **or** clear error (no blank crash). Pull-to-refresh works. | [ ] | [ ] | Public catalog |
| 5 | **Listing detail → Report sheet → cancel** | Open a listing → detail renders → open **Report** sheet → **Cancel** dismisses without submit. | [ ] | [ ] | Do not file a real report against shared seed unless intentional |
| 6 | **Jobs browse + mine (auth)** | **Jobs** → **Browse**: public open jobs list/detail. Sign in with seed customer (or real account). **Mine**: loads owner jobs **or** empty/error with clear copy (not infinite spinner). Scaffold session should prompt to sign in for Mine. | [ ] | [ ] | Auth required for Mine |
| 7 | **Messages channels (auth)** | **Messages** tab with real session: channel/thread list or empty. Scaffold: clear “sign in” guidance (no crash). | [ ] | [ ] | Auth required |
| 8 | **Place bid UI** | From listing or job detail, open place-bid UI. **Expected:** form validates; API may **fail** without provider role / bid eligibility — surface error, do not crash. Scaffold session: no-API-credentials messaging. | [ ] | [ ] | Provider seed may be required for success; failure is OK if UX is clear |
| 8b | **Buy now → Apple Pay sheet** | Listing with `buy_now_price` + real auth + Stripe key configured. **Buy now** creates order and presents **Stripe PaymentSheet** (Apple Pay when device-eligible, else card). Cancel is OK; full charge only on staging seed you own. Without `pk_`: clear “not configured” error. | [ ] | [ ] | Rail A **3.1.3(e)** — not StoreKit |
| 8c | **Orders → Pay with Apple Pay** | **Account → Orders**. List loads; `pending_payment` row shows **Pay with Apple Pay**. Tapping opens PaymentSheet again (pay-retry). | [ ] | [ ] | |
| 9 | **Account legal links** | **Account** → Privacy Policy, Terms of Service, Support (and Community Guidelines if exercised). Each opens in-app Safari (`SFSafariViewController` / legal web view) to `no-markup.com` URLs — not a broken blank. | [ ] | [ ] | Guideline **5.1.1.i** |
| 10 | **Export data / Delete account flow UI** | **Auth session only.** **Export Data**: triggers export path; success byte count or API error shown. **Delete Account**: navigates to confirm UI (`DELETE` phrase). **Do not complete deletion on shared seed** unless intentional. Scaffold: export disabled; deletion explains missing credentials. | [ ] | [ ] | Guideline **5.1.1.v** |
| 11 | **Sign out** | **Account** → **Sign out** returns to login / unauthenticated chrome. Protected tabs stop using the old token. | [ ] | [ ] | |
| 12 | **Sign in with Apple button visible** | On login screen, **Sign in with Apple** control is visible and tappable. Full flow **may fail** without Apple Developer team / SIWA App ID / `APPLE_NATIVE_CLIENT_ID` on gateway — document actual result. | [ ] | [ ] | Guideline **4.8** when team is configured |

---

## Sign-off

| Field | Value |
|-------|--------|
| Tester | |
| Date | |
| Build / version | `CFBundleShortVersionString` (`CFBundleVersion`) — see Account → About |
| Simulator / device | e.g. iPhone 16 / iOS 18.x |
| API base | |
| Overall | [ ] **PASS** · [ ] **FAIL** (block submit) · [ ] **PASS with notes** |

### Failures to file

| Step # | Severity | Summary | Owner |
|--------|----------|---------|-------|
| | | | |

---

## Launch board link

Track Stage C residual and binary readiness on the program board:

→ **[`docs/compliance/launch-board.md`](./launch-board.md)**

When this checklist is human-executed and signed, update launch-board **Device smoke matrix** from “checklist only” to signed-off (or list residual fails under Next).

---

## Hard-off keys (reference)

Client always forces **off** regardless of `GET /api/v1/flags`:

| Key | Product surface (must not ship UI) |
|-----|-------------------------------------|
| `customer_bnpl` | Customer BNPL / installment plans |
| `working_capital` | Working-capital advances |
| `per_job_insurance` | Per-job insurance purchase |
| `insurance_competition` | Insurance competition |
| `legal_services` | Legal services marketplace |
| `lead_gen` | Lead-gen fee surfaces |
| `instant_payout` | Instant payout CTA |

Source: `ios/NoMarkup/Core/FeatureFlags.swift` · product cut: [`v1-ios-product-cut.md`](./v1-ios-product-cut.md).
