# App Review Notes (NoMarkup)

**Purpose:** Paste/adapt into App Store Connect **App Review Information → Notes**
and internal review packaging.  
**Source ASR IDs:** ASR-PRE-03, ASR-PRE-04 / BYS.2, ASR-PRE-06 / BYS.4, ASR-2.3.1.a.1.  
**Product today:** Web marketplace at **no-markup.com** (hyphenated). Native iOS
binary is **not** submitted in this packaging pass — see
`ios-payment-rails-design.md` for deferred dual-rail design.

---

## Support ownership (ASR-PRE-03 / BYS.1)

| Field | Value |
|-------|--------|
| Support email | **support@no-markup.com** |
| In-app path | `/support` (when shipped) + Settings / footer contact |
| Ownership | Platform Support (ops); escalations for payments/disputes to admin queue |
| Do not use | Personal founder Gmail, `support@example.com` fixtures |

Reviewers: prefer email to **support@no-markup.com** with the demo account email
in the body so we can correlate logs.

---

## Demo accounts (from `E2E.md` / seed)

Seed after stack is up (`make seed`). Password is **not** committed:

- Capture from seed log (`dev-account password`) **or** set `SEED_PASSWORD` before `make seed`.
- All four accounts share the same `$SEED_PASSWORD`.

| Email | Role |
|-------|------|
| `admin@nomarkup.com` | admin |
| `customer@nomarkup.com` | customer |
| `provider@nomarkup.com` | provider |
| `provider2@nomarkup.com` | provider |

**Staging note:** Full funnel dogfood needs live gateway + services + engines +
Postgres seed. CI Playwright is Chromium **backend-tolerant smoke** only
(see `E2E.md`).

Suggested review path:

1. Login as `customer@…` → browse `/jobs` and `/marketplace` in **King County** markets.
2. Login as `provider@…` → `/provider/workspace` for check-in purpose UX (GPS).
3. Login as `admin@…` only if reviewing moderation queues.

---

## Feature flag matrix (money / regulated)

Canonical keys: `web/src/hooks/useFeatureFlags.ts` + `feature_flags` table  
(migrations `013`, `060`). Gateway `RequireFlag` → **503** when row exists and
`enabled=false` (fails closed in production for missing/error/nil DB).

| Flag key | Default seed (060 / 013) | Surface | First iOS binary guidance |
|----------|--------------------------|---------|---------------------------|
| `live_auction` | true (013) | Live auction arena | Keep if product ships auctions |
| `spectator_mode` | false | Anonymous auction watch | Optional |
| `nomarkup_guarantee` | false | Guarantee claims | Optional |
| `smart_matching` | false | Auto-match | Optional |
| `provider_business_os` | false | Provider business OS | Optional |
| `fair_price_index` | false | Fair price widget | Optional |
| `marketplace_offers` | (if present) | Offers flow | Optional |
| `customer_bnpl` | **true** (060) | BNPL installments | **Flag OFF** until licenses |
| `instant_payout` | **true** (060) | Instant payout | **Flag OFF** or keep Stripe-only web |
| `per_job_insurance` | **true** (060) | Per-job insurance | **Flag OFF** until licenses |
| `working_capital` | **true** (060) | Provider advances | **Flag OFF** until licenses |
| `insurance_competition` | **false** (060) | Multi-carrier quotes | Stay off |
| `legal_services` | **false** (060) | Legal vertical | Stay off |
| `lead_gen` | **false** (060) | Paid leads | Stay off |

Financial / regulated keys also **fail closed in the web UI** when missing
(`FINANCIAL_FEATURE_FLAG_KEYS` default `false`).

---

## Escrow rails (ASR-3.1.3.e)

- **Services & goods GMV** settle via **Stripe Connect Express** escrow.
- Customer funds held until contract/order completion paths as implemented;
  release/refund carry an **actor** (provider cannot self-release escrow;
  refund after payout is admin-only).
- **Physical goods + real-world services** are not digital content unlocks —
  they correctly use external payment (Guideline **3.1.3(e)** marketplace
  exception), not IAP.
- **Digital subscription tiers** (analytics access, featured placement, bid
  limits, etc.) are currently Stripe on **web**; iOS packaging requires
  StoreKit for those unlocks — see `ios-payment-rails-design.md`.

---

## Geo markets

- Launch pilot: **King County, WA** markets (migration `058_launch_wa_king_county`):
  Auburn, Maple Valley, Black Diamond, Enumclaw, Kent, Renton (active set).
- Market picker geolocation purpose: nearest launched market only; user can
  pick a city instead (ASR-5.1.5).
- Goods: local pickup model / radius product rules as documented in
  `docs/marketplace.md`.

---

## Age gate (18+)

- Global minimum age **18** (`minAgeYears` in gateway compliance handler).
- DOB captured via `PUT /api/v1/me/dob`; only verification boolean exposed via
  `/api/v1/me/age-status`. DOB encrypted at rest (secretbox).

---

## Report / block (how to test)

| Action | Where |
|--------|--------|
| Block user | Chat / profile surfaces → block; list via `GET /api/v1/me/blocks` |
| Report user | User report API + admin queue `/admin/user-reports` |
| Report listing | Listing report **API** exists; frontend “Report this listing” tracked as UGC remediation |
| Report message | In-chat report UI (where shipped) |

Admin: sign in as `admin@…` → moderation queues for reports.

---

## Dual payment note (reviewers)

| Rail | What | Processor |
|------|------|-----------|
| **Marketplace GMV / escrow / insurance PI / payouts** | Real-world jobs, physical goods, Connect transfers | **Stripe** (web + future native shell for offline goods/services) |
| **Digital feature subscriptions** | Analytics, featured placement, bid-limit tiers, etc. | **Stripe on web today**; **StoreKit IAP** required on iOS binary (deferred design doc) |

Apple Pay / Google Pay (when enabled) are Stripe payment methods; domain
association file must be production content (see
`web/public/.well-known/README.md`). NoMarkup never stores raw card numbers.

**Privacy (policy sentence for legal page / ASC):**  
*Payments, including card, Apple Pay, and Google Pay, are processed by Stripe.
NoMarkup does not store full card numbers or payment credentials on our servers.*

---

## Privacy / consent (shipped in this P1 pack)

- Cookie banner defaults **analytics and marketing off** (opt-in).
- Browser Sentry enabled only with analytics consent (`nm:consent`).
- Location purpose strings on market selector and provider check-in.
- Settings → Security → **Connected accounts** (OAuth unlink, lockout-safe).

---

## What is intentionally DEFERRED for packaging

- Native shell / non-thin WebView (ASR-4.2).
- StoreKit dual-rail implementation (design only — `ios-payment-rails-design.md`).
- Org licenses for insurance / advances / BNPL on iOS (flag-off strategy).
- Full ASC metadata, screenshots, age rating questionnaire.
- mTLS mesh, `DEPLOY_PROVISIONED` production gate.
