# App Review Notes (NoMarkup)

**Purpose:** Paste into App Store Connect **App Review Information → Notes** (and internal packaging).  
**As of:** 2026-08-02  
**Binary:** Native SwiftUI iOS (`ios/NoMarkup`) — free-tier digital, dual-rail GMV via Stripe  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) · [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) · [`submission-blockers.md`](./submission-blockers.md)

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
from our seed process / SEED_PASSWORD env; not committed to source control)
═══════════════════════════════════════════════════════════════
Primary path:
  customer@nomarkup.com   role: customer

Also available:
  provider@nomarkup.com   role: provider
  provider2@nomarkup.com  role: provider
  admin@nomarkup.com      role: admin (moderation only if needed)

All seed accounts share the same password provided in the ASC password field.

How we create seed passwords (for your ops peer, not for the Notes field):
  1) Start API stack; run `make seed` (or project seed equivalent)
  2) Password is printed in seed log as “dev-account password”, OR set
     SEED_PASSWORD before seeding
  3) Paste that value into ASC “Password” — never into public Review Notes,
     git, or screenshots

═══════════════════════════════════════════════════════════════
API / BACKEND (must be up for review)
═══════════════════════════════════════════════════════════════
Release API base: https://api.no-markup.com
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
   - Your data: Export Data, Delete Account (please do NOT complete
     deletion on the shared demo account)
   - Plan limits: free-tier comparison only — NO In-App Purchase
8) Optional: place-bid / Buy Now UI may appear; live charges require
   Stripe keys on the review environment — failure without keys is OK

═══════════════════════════════════════════════════════════════
FREE-TIER ONLY — NO IAP AT LAUNCH
═══════════════════════════════════════════════════════════════
This binary does NOT include In-App Purchases or a digital subscription
paywall. StoreKit is intentionally omitted (scaffold off / not linked for
purchase). Account → Plan limits and Subscriptions copy state that paid
Pro/Business digital unlocks are web-only until a future StoreKit release.
There is no “buy digital cheaper on the web” CTA inside the app.

═══════════════════════════════════════════════════════════════
PAYMENTS (dual-rail)
═══════════════════════════════════════════════════════════════
Rail A — Real-world GMV (Guideline 3.1.3(e)):
  Physical goods local-pickup orders and real-world service escrow use
  Stripe (PaymentSheet / Connect). Not digital content unlocks. Not IAP.

Rail B — Digital feature tiers:
  Analytics, featured placement, bid-limit upgrades, etc. are NOT sold
  in this binary. Free-tier baseline only.

═══════════════════════════════════════════════════════════════
REGULATED RAILS — EXPECT OFF
═══════════════════════════════════════════════════════════════
BNPL, working capital/advances, per-job insurance, insurance competition,
legal services vertical, lead gen, and instant payout are controlled by
SERVER feature flags (gateway RequireFlag). Review / production should
keep these flags OFF. Client does not hard-block the keys in code
(iOSHardOffKeys is empty); server is authoritative. Do not expect those
purchase flows during review.

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
OTHER
═══════════════════════════════════════════════════════════════
Age: platform 18+ age gate (DOB)
Geo pilot: King County, WA markets (e.g. Kent, Renton, Auburn, …)
Push: app may register for APNs; Device ID is for delivery, not tracking
Encryption / export: standard HTTPS/TLS only in the client
  (ITSAppUsesNonExemptEncryption = false)
ATT / IDFA: not used — no ad network SDK

Contact: support@no-markup.com (include demo account email in body)
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

**iOS:** `FeatureFlags.iOSHardOffKeys` is **empty**. Server flags are authoritative. UI hub: Account → Business & finance / Feature flag status.

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
- Platform minimum age **18** (native `AgeGateView` + server DOB).

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
