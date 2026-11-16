# NoMarkup — Frontend↔Backend Wiring Audit

**Date:** 2026-06-04
**Method:** Static cross-reference (no live stack). Four layers mapped and matched:
1. Gateway route table — `gateway/internal/router/router.go` (~250 HTTP routes) = backend's exposed surface.
2. Frontend demand — every `api.*()` / `fetch()` / WebSocket call in `web/src` (~215 unique endpoints), mapped to feature.
3. Gateway handler depth — real gRPC/DB call vs stub/mock per handler.
4. Service/engine coverage — implemented vs `Unimplemented` gRPC methods across 5 Go services + 4 Rust engines.

**Verdict:** The platform is overwhelmingly wired correctly — frontend calls, gateway routes, handlers, and gRPC services line up across hundreds of endpoints. But there are **6 confirmed dead wires** (frontend calls a path the gateway does not serve → guaranteed 404), **2 unwired upload flows**, **1 payout stub that fakes success**, and a set of unimplemented gRPC methods + orphan routes worth tracking.

---

## 🔴 BLOCKERS — confirmed broken frontend→backend wiring (404 today)

Each verified in source on both sides. The frontend calls a path string the gateway router has no route for.

| # | Feature | Frontend calls | Gateway actually serves | Evidence |
|---|---|---|---|---|
| 1 | **Forgot password** (request reset) | `POST /api/v1/auth/forgot-password` | `POST /api/v1/auth/request-password-reset` | FE `web/src/components/forms/ForgotPasswordForm.tsx:44` · GW `router.go:127` |
| 2 | **Resend verification email** | `POST /api/v1/auth/verify-email/resend` | `POST /api/v1/auth/resend-verification` | FE `web/src/app/(dashboard)/layout.tsx:51` · GW `router.go:126` |
| 3 | **Change password** (settings) | `POST /api/v1/auth/change-password` | *no route or handler exists* | FE `web/src/app/(dashboard)/settings/security/page.tsx:366` · GW: absent (grep found nothing) |
| 4 | **Market price range** (analytics) | `GET /api/v1/analytics/market-range` | `GET /api/v1/analytics/market/range` (hyphen vs slash) | FE `web/src/hooks/useAnalytics.ts:22` · GW `router.go:292-294` |
| 5 | **Dispute a goods order** | `POST /api/v1/orders/{id}/dispute` | `POST /api/v1/orders/{id}/file-dispute` | FE `web/src/hooks/useListings.ts:328` · GW `router.go:542` |
| 6 | **Order detail page** (fetch order) | `GET /api/v1/orders/{id}` | *no GET on `/orders/{id}`* (only POST sub-routes) | FE `web/src/hooks/useListings.ts:306` · GW `router.go:540-546` |

**Fix shape:** 1, 2, 4, 5 are pure path-string typos — fix on whichever side you consider canonical (frontend strings are the cheaper change; one line each). 3 and 6 are **missing backend routes** — `change-password` needs a gateway route + handler (likely a user-service `ChangePassword` RPC), and `GET /orders/{id}` needs an order-detail handler (the data exists; `listing_orders` is queried elsewhere).

> Impact by persona: #1/#2/#3 hit **every user** (password & email management). #5/#6 break the **goods buyer** post-purchase flow (order page + dispute). #4 breaks the **analytics/market-range** widget.

---

## 🟠 Unwired UI — uploads that fake the backend

Both store browser `blob:` URLs as if they were uploaded assets. The form submits successfully but the images are local-only and die on reload — the real image pipeline (`/api/v1/images/upload-url` → presigned PUT → `/api/v1/images/confirm`, which *is* wired and used elsewhere) is bypassed.

| Feature | File | Problem |
|---|---|---|
| **Marketplace listing photos** | `web/src/components/marketplace/ListingPostingForm.tsx:240-245` | `URL.createObjectURL(f)` stored as listing photo; `POST /api/v1/listings` submits `blob:` URLs. Comment admits "Stub … object URLs as placeholder." |
| **Insurance claim evidence** | `web/src/components/insurance/InsuranceClaimForm.tsx:83-99` | Evidence files become `blob:` URLs, submitted verbatim in `evidence_urls` on `POST /api/v1/insurance/claims`. Comment: "For now, we create object URLs as placeholders." |

**Fix shape:** route both through the existing `useImageUpload` flow (already used by job photos / avatars / portfolio).

---

## 🟠 Gateway stub that reports false success

| Handler | File | Problem | Severity |
|---|---|---|---|
| `PaymentHandler.InstantPayout` | `gateway/internal/handler/payment.go:544-569` | Returns `200` with a fabricated `payout_id = "payout-"+userID` and `"Within minutes"`. Never calls `paymentClient`, never touches Stripe. **Tells a provider they were paid out when no money moved.** | **BLOCKER if `/payments/instant-payout` is exposed in prod** |

Frontend wires it at `web/src/hooks/usePayments.ts:197`, so the button is live.

---

## 🟡 Unimplemented gRPC methods (declared in proto, return `codes.Unimplemented`)

All Go servers embed `Unimplemented*ServiceServer`, so any proto RPC with no handler silently 500s if called. **Most of these are NOT reached by the gateway today** (no gateway route invokes them) — they're contract-ahead-of-impl, not live breakage. The ones to watch are flagged.

| Service | RPC | Reached by gateway? | Note |
|---|---|---|---|
| user | `RequestPasswordReset`, `ResetPassword` | **Indirectly relevant** | Gateway's reset routes exist; confirm they don't depend on these RPCs (handler may do its own thing). Worth checking given blocker #1. |
| user | `DeactivateAccount` | No | Account uses delete/restore lifecycle instead. |
| chat | `ShareContactInfo`, `GetSharedContacts`, `AdminGetChannelMessages` | No | No gateway route. |
| job | `RepostJob`, `ListProviderBiddedJobs`, `AdminCreate/Update/DeleteCategory` | No | `RepostJob` has service-layer logic (`services/job/internal/service/job.go:238`) but no gRPC handler; admin category CRUD has no gateway route either. |
| payment | `ChargeListingWinner`, `ConfirmListingPickup`, `FileListingDispute`, `ResolveListingDispute`, `AutoReleaseListingOrders` | **Verify** | Goods escrow RPCs. Gateway order handlers (`confirm-pickup`, `file-dispute`, admin resolve) appear to run **direct SQL state-transitions** rather than these RPCs, so the flows may work without them — **but `ChargeListingWinner` (winner actually gets charged) has service logic at `listing_charge.go:238` that is not wired to any gRPC handler.** Confirm how a goods auction winner / buy-now is charged. |

Engines (bidding/fraud/trust/imaging) and the notification service are **fully implemented — zero stubs**.

---

## 🟡 Orphan backend routes — wired in gateway, no frontend caller found

Not breakage (backend ahead of frontend, or mobile/automated/external consumers), but listed so you can decide intentional vs forgotten. Verify before deleting — the frontend mapper may have missed a caller.

- **Contract lifecycle (rich):** `change-orders` (create/list/respond), `report-noshow`, `report-abandonment`, `GET /contracts/{id}/pdf`, milestones `submit`/`approve`/`revision` — no frontend caller seen.
- **Provider profile setters:** `PUT /providers/me/categories`, `/portfolio`, `/availability`; `POST/GET /providers/me/documents`, `/documents/{type}/status`; employee `POST`/`PATCH` (only GET+DELETE are called) — verify provider onboarding wiring.
- **Marketplace:** `POST /listings/{id}/bids/{bidId}/retract`, `POST /listings/{id}/report`, `POST /orders/{id}/seller-confirm`, `POST /orders/{id}/report-no-show` — no frontend caller seen.
- **Subscriptions:** `POST /subscriptions` (create), `/change-tier`, `GET /features/{feature}` — only me/tiers/usage/invoices/cancel are called.
- **Bids/images:** `GET /bids/analytics`, `GET /bids/{id}`; `/images/process*` family (process/job-photos/avatar/portfolio/document) — frontend uses upload-url+confirm only.
- **Expected/intentional (no action):** `webhooks/stripe|subscription` (Stripe→server), `GET /me/calendar.ics` (external calendar subscription), `notifications/devices` FCM/APNs (mobile), admin metrics sub-routes (`platform/geographic`, `payments/fee-config`, `category-questions` CRUD, `admin/flags`) — some are admin-only screens that may exist but weren't traced.

---

## Minor / lower-confidence

- A few hooks issue a `GET` to a path whose real action is `POST` (e.g. `reviews/{id}/respond`, `fraud/alerts/{id}/review`, `guarantee-claims/{id}/review`) — the authoritative mutation uses the correct verb; the GET reads are likely eligibility/peek calls. Glance to confirm.
- Documented temporary shortcuts that are **fine** (not bugs): phone-only signup synthesizes a placeholder email until a `RegisterByPhone` RPC ships (`auth.go`); listings without pickup coords store `ST_MakePoint(0,0)` until edited (`listings_write.go`); chat relay leaves the phone alias NULL in dev and the UI hides "call" (`chat_relay.go`); dev sentinel `client_secret`s when Stripe is unconfigured (guarded by `paymentClient != nil`).
- GDPR account-deletion TODOs in user-service: deletion confirmation **emails are logged, not sent** (`services/user/internal/service/deletion.go:119,122,155`) and **S3 objects + OAuth links are not purged** (`services/user/cmd/server/main.go:208`). Compliance gap, not a wiring break.

---

## Recommended order of fixes
1. **Blockers #1–#3** (auth: forgot-password, resend-verification, change-password) — every user, trivial path fixes + one new route.
2. **InstantPayout stub** — gate the route off or wire it before any provider can hit it (fakes payment success).
3. **Blockers #5–#6** (goods order detail + dispute) — goods buyers are dead-ended post-purchase.
4. **Blocker #4** (analytics market-range path).
5. **Two upload stubs** (listing photos, insurance evidence) — data-loss on submit.
6. **Verify `ChargeListingWinner` path** — confirm goods winners actually get charged.
7. Triage orphan routes (frontend-behind-backend) feature by feature.
