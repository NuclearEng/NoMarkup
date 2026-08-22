# App Review Notes (NoMarkup)

**Purpose:** Paste into App Store Connect **App Review Information → Notes** (and internal packaging).  
**As of:** 2026-08-21  
**Binary:** Native SwiftUI iOS (`ios/NoMarkup`) — free-tier digital, dual-rail GMV via Stripe  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) · [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) · [`submission-blockers.md`](./submission-blockers.md)

Founder residual (do **not** claim done in ASC): production API is **not** live; screenshots, App Review contact, and Privacy Policy URL in the portal are still founder/ops. Password for demo accounts belongs **only** in the ASC Password field — never in these notes.

---

## Non-obvious features (ASR-4.4, 3.0.1, PRE-06) — paste-ready bullets

```text
• Widgets: Active Bids, Next Closing. Live Activities for auction
  countdown after a bid. iOS 18 Control Center widgets (Post a Job,
  Check In). No ads or IAP in the extension.
• Age: 18+ DOB gate, fail-closed. Users cannot use the signed-in app
  until age is verified.
• UGC: Report on jobs AND listings AND users/chat/reviews. Block.
  Community Guidelines in-app (Account → Legal & support).
• Payments: Rail A Stripe/Apple Pay for goods and offline services
  only. StoreKitEnabled=false — no digital unlock purchase.
  Regulated rails hard-off on iOS (BNPL, insurance, working capital,
  instant payout, legal, lead_gen) regardless of server seed.
• Demo accounts (same password, ASC Password field only):
  customer@nomarkup.com (primary), provider@nomarkup.com,
  provider2@nomarkup.com, admin@nomarkup.com.
```

---

## ASC paste block (copy entire fenced block into App Review Notes)

```text
NoMarkup is a local two-sided marketplace:
• Services: reverse-auction jobs (providers compete on price)
• Goods: forward-auction / Buy Now marketplace with local pickup

This is a NATIVE SwiftUI app (TabView: Home, Marketplace, Jobs, Messages,
Account). It is NOT a website wrapper / pure WKWebView shell (Guideline 4.2).
SFSafariViewController is used only for legal/support HTML and optional
“open on web” convenience links.

═══════════════════════════════════════════════════════════════
DEMO ACCOUNTS (password is in the App Review PASSWORD field only —
not committed to source control; never paste the password here)
═══════════════════════════════════════════════════════════════
Primary path:
  customer@nomarkup.com   role: customer

Also available:
  provider@nomarkup.com   role: provider
  provider2@nomarkup.com  role: provider
  admin@nomarkup.com      role: admin (moderation only if needed)

All seed accounts share the same password provided in the ASC password field.

═══════════════════════════════════════════════════════════════
API / BACKEND (founder residual — not yet live)
═══════════════════════════════════════════════════════════════
Intended review API: https://api.no-markup.com
This host is NOT provisioned yet (DEPLOY_PROVISIONED unset).
App Review cannot complete until founder/ops brings a review API
up with seed data. Do not treat this as a live production backend.
Bundle ID: com.nomarkup.app
Sign in with Apple: POST /api/v1/auth/apple/native
  Audience: APPLE_NATIVE_CLIENT_ID = com.nomarkup.app (Bundle ID)

═══════════════════════════════════════════════════════════════
SUGGESTED REVIEW PATH
═══════════════════════════════════════════════════════════════
1) Cold launch → Login (or browse shell if offered) → observe native chrome
2) Sign in as customer@nomarkup.com (or Sign in with Apple)
3) Home tab — market context / feed
4) Marketplace tab — browse public listings → open a listing detail
5) Jobs tab — browse public jobs → open a job detail
6) Messages tab — channel list (seed may include threads)
7) Account tab:
   - Legal: Privacy Policy, Terms, Community Guidelines, Support
   - Widgets & Live Activities (how to add Home Screen widgets)
   - Your data: Export Data, Delete Account (please do NOT complete
     deletion on the shared demo account)
   - Plan limits: free-tier comparison only — NO In-App Purchase
8) Optional: place-bid / Buy Now UI may appear; live charges require
   Stripe keys on the review environment — failure without keys is OK

═══════════════════════════════════════════════════════════════
WIDGETS / LIVE ACTIVITIES / CONTROL CENTER (Guideline 4.4)
═══════════════════════════════════════════════════════════════
Home Screen / Lock Screen widgets:
  • Active Bids — count of auctions the signed-in user is bidding on
  • Next Closing — countdown to the next auction close
Live Activities: auction countdown after the user places a bid
  (Lock Screen + Dynamic Island)
iOS 18 Control Center: Post a Job and Check In controls
The widget extension contains no ads, marketing, or In-App Purchase.
How to add: long-press Home Screen → Edit → Widgets → NoMarkup.
In-app help: Account → Legal & support → Widgets & Live Activities

═══════════════════════════════════════════════════════════════
FREE-TIER ONLY — NO IAP AT LAUNCH
═══════════════════════════════════════════════════════════════
StoreKitEnabled=false. This binary does NOT include In-App Purchases
or a digital subscription paywall. There is no digital unlock purchase
and no “buy digital cheaper on the web” CTA inside the app.
Account → Plan limits compares free launch limits only.

═══════════════════════════════════════════════════════════════
PAYMENTS (dual-rail) — Guideline 3.0.1 / 3.1.3(e)
═══════════════════════════════════════════════════════════════
Rail A — Real-world GMV:
  Physical goods (local pickup) and offline/real-world service escrow
  use Stripe PaymentSheet / Apple Pay / Connect. Not digital unlocks.
  Not IAP.

Rail B — Digital feature tiers:
  Analytics, featured placement, bid-limit upgrades, etc. are NOT sold
  in this binary. Free-tier baseline only. StoreKitEnabled=false.

═══════════════════════════════════════════════════════════════
REGULATED RAILS — HARD-OFF ON iOS
═══════════════════════════════════════════════════════════════
These keys are hard-off in the iOS binary regardless of server seed:
  customer_bnpl, working_capital, per_job_insurance,
  insurance_competition, legal_services, lead_gen, instant_payout
Do not expect BNPL, insurance, working capital, instant payout, legal
services, or lead-gen purchase flows during review.

═══════════════════════════════════════════════════════════════
ACCOUNT DELETION / PRIVACY (5.1.1)
═══════════════════════════════════════════════════════════════
In-app: Account → Your data → Delete Account
  (typed confirmation + optional Face ID step → DELETE /api/v1/users/me,
  ~30-day grace on server)
Export: Account → Export Data
Privacy Policy URL: https://no-markup.com/privacy
Support: https://no-markup.com/support · support@no-markup.com

═══════════════════════════════════════════════════════════════
UGC / SAFETY
═══════════════════════════════════════════════════════════════
Report on jobs AND listings AND users/chat/reviews.
Block abusive users (Account → Network & safety → Blocked users).
Community Guidelines: Account → Legal & support (also /community-guidelines).

═══════════════════════════════════════════════════════════════
OTHER
═══════════════════════════════════════════════════════════════
Age: 18+ DOB gate, fail-closed. Users cannot use the signed-in app
until age is verified (a network error does not bypass the gate).
Geo pilot: King County, WA markets (e.g. Kent, Renton, Auburn, …)
Push: app may register for APNs; Device ID is for delivery, not tracking
Encryption / export: standard HTTPS/TLS only in the client
  (ITSAppUsesNonExemptEncryption = false)
ATT / IDFA: not used — no ad network SDK

Contact: support@no-markup.com (include demo account email in body)
  ASC contact/phone/screenshots: founder residual — not claimed complete.
```

---

## Support ownership

| Field | Value |
|-------|--------|
| Support email | **support@no-markup.com** |
| Support URL | https://no-markup.com/support |
| Privacy URL | https://no-markup.com/privacy |
| In-app | Account → Legal & support |

Do not use personal Gmail or `support@example.com` in ASC.

---

## Demo accounts (seed pattern — no real passwords in git)

| Email | Role | Use |
|-------|------|-----|
| `customer@nomarkup.com` | customer | **Primary** App Review path |
| `provider@nomarkup.com` | provider | Bid / workspace / provider surfaces |
| `provider2@nomarkup.com` | provider | Second provider / empty-ish states |
| `admin@nomarkup.com` | admin | Moderation only if needed (no admin-only iOS chrome) |

**Password:** Not stored in this repo. After `make seed` (or equivalent), capture from seed log (`dev-account password`) **or** set `SEED_PASSWORD` before seed. All seed accounts share that one password. Place it **only** in ASC App Review **Password** field and ops vault.

UITest harness may use env `NOMARKUP_UI_TEST_PASSWORD` / defaults for local automation — **not** for ASC paste.

---

## Feature flag matrix (review env)

Canonical keys: `feature_flags` table + `GET /api/v1/flags`. Gateway `RequireFlag` fails closed in production when disabled.

| Flag key | Review / first-ship guidance |
|----------|------------------------------|
| `customer_bnpl` | **OFF** until licenses |
| `working_capital` | **OFF** until licenses |
| `per_job_insurance` | **OFF** until licenses |
| `insurance_competition` | **OFF** |
| `legal_services` | **OFF** |
| `lead_gen` | **OFF** |
| `instant_payout` | **OFF** (or Stripe-only web) |
| Catalog / auction / messaging flags | ON as needed for demo depth |

**iOS:** regulated keys above are **hard-off in the binary regardless of server seed** (v1). Review/prod DB flags should still stay **OFF**. Diagnostic hub: Account → Feature flag status.

---

## Dual payment note (reviewers)

| Rail | What | Processor |
|------|------|-----------|
| **A — GMV** | Jobs escrow, goods orders, Connect payouts | **Stripe** (**3.1.3(e)**) — not IAP |
| **B — Digital tiers** | Analytics, featured, bid limits, etc. | **Not in this binary**; web Stripe only until StoreKit (B2) |

Apple Pay (when merchant ID + domain association + `pk_` configured) is a Stripe payment method — not digital IAP.

---

## Sign in with Apple

| Item | Value |
|------|--------|
| Client | System Sign in with Apple button (`AuthenticationServices`) |
| Exchange | **`POST /api/v1/auth/apple/native`** |
| Body | `{ "identity_token", "full_name"?, "nonce"? }` |
| Audience | `APPLE_NATIVE_CLIENT_ID` = Bundle ID `com.nomarkup.app` |
| Web OAuth path | Separate Safari/`form_post` path — not primary native |

Guideline **4.8:** SIWA offered with other third-party logins (Google/Facebook where configured).

---

## Escrow / GMV (3.1.3(e))

- Services & goods GMV via **Stripe Connect Express** escrow as implemented.
- Provider cannot self-release escrow; refund-after-payout is admin-only.
- Physical goods + real-world services are **not** digital unlocks.

---

## Geo / age

- Pilot markets: King County, WA (Auburn, Maple Valley, Black Diamond, Enumclaw, Kent, Renton, …).
- Platform minimum age **18** (native `AgeGateView` + server DOB). Gate is **fail-closed**: a signed-in user cannot use the app until age is verified.

---

## What is intentionally deferred

| Item | Status |
|------|--------|
| StoreKit / IAP digital purchase | **Deferred** free-tier lock |
| Regulated rails live | Server **off** until licenses |
| Admin iOS console | Web-only by design |
| ASC portal fill / signing / screenshots | **Founder** — see submission-blockers |

---

*Owner: App Store launch readiness. Update only when binary scope, Bundle ID, or free-tier decision changes.*
