# Security gate evidence — showcase program

**Date:** 2026-07-26  
**Scope:** Money / auth / PII controls relevant to iOS + gateway catalog & commerce surfaces  
**Method:** Static audit with path:line citations (no invented coverage)  
**Related:** [`showcase-living-checklist.md`](./showcase-living-checklist.md) global security gates · [`adr-2026-07-26-money-integrity-residual.md`](./adr-2026-07-26-money-integrity-residual.md) · [`docs/planning/adversarial-action-tracker.md`](../planning/adversarial-action-tracker.md)

---

## Verdict (this pass)

| Check | Result |
|-------|--------|
| 1. Idempotency-Key on listed money mutations | **PASS (middleware + sticky clients)** — job bid, listing bid, buy-now, order pay, bid-bond create/confirm: gateway enforces + web/iOS send headers. **iOS sticky keys** (web parity): `APIClient.idempotencyHeader(for:)` + clear-on-success for job/listing bid, bond create/confirm, payment release. Residual: handler durable SQL dedup for job bid/bond (SEC-GATE-07 class) |
| 2. No force-unwraps in iOS money paths | **PASS** |
| 3. `iOSHardOffKeys` still enforced | **PASS** |
| 4. Amounts are `Int64` cents in API bodies | **PASS** (iOS encode + gateway decode) |
| 5. confirm-pickup / seller-confirm exist + auth-gated | **PASS** |
| Residual money races (MON-14–18 etc.) | **Open** — tracked; not closed by this gate |
| Idempotency Redis cache policy | **PASS** — 2xx-only replay (5xx/4xx retriable with same key) |
| Goods take rate vs fee config | **PASS** — R6.1 wires mint+charge to `platform_fee_config` |
| Guarantee approve → CreateRefund | **PASS** — ReviewGuaranteeClaim refunds before resolve; stamp `guarantee_paid_at`; fail-closed without refundable payment |
| Bid-bond durable SQL idempotency | **PASS** — migration 109 + CreateBidBond soft-replay on (user, listing, key) |
| Job PlaceBid sticky retry UX | **PASS** — AlreadyExists + same amount soft-replays active bid (no double row) |
| Guarantee multi-payment payout | **PASS** — oldest-first allocation; underfunded fail-closed |

**Gate overall:** **PASS WITH GAPS** — middleware Idempotency-Key gaps closed same day; production money races (MON-14–18) and iOS hard-off rails remain separate.

---

## 1. Idempotency-Key — job bid, listing bid, buy-now, pay order, bid bond

### Summary matrix

| Mutation | Gateway route | `RequireIdempotencyKey` | iOS sends header | Web sends header |
|----------|---------------|-------------------------|------------------|------------------|
| Job bid | `POST /api/v1/jobs/{id}/bids` | **Yes** (+ auth) | **Yes** | **Yes** |
| Listing bid | `POST /api/v1/listings/{id}/bids` | **Yes** | **Yes** | **Yes** |
| Buy-now | `POST /api/v1/listings/{id}/buy-now` | **Yes** | **Yes** | **Yes** |
| Pay order | `POST /api/v1/orders/{id}/pay` | **Yes** | **Yes** | **Yes** |
| Bid bond create | `POST /api/v1/listings/{id}/bid-bond` | **Yes** | **Yes** | **Yes** |
| Bid bond confirm | `POST /api/v1/listings/{id}/bid-bond/confirm` | **Yes** | **Yes** | **Yes** |

### Gateway — middleware contract

```89:91:gateway/internal/middleware/idempotency.go
			key := r.Header.Get(idempotencyKeyHeader)
			if key == "" {
				http.Error(w, `{"error":"Idempotency-Key header is required for payment mutations"}`, http.StatusBadRequest)
```

Header name is `Idempotency-Key` (`idempotencyKeyHeader` at line 55).

### Gateway — route mounts

**Job bid — auth + RequireIdempotencyKey (MON-06/22 parity with listing bids):**

```256:258:gateway/internal/router/router.go
		// MON-06/22: money-adjacent mutation requires Idempotency-Key (parity with listing bids).
		r.With(authMW.Handler, middleware.RequireIdempotencyKey(cacheClient)).
			Post("/{id}/bids", bidHandler.PlaceBid)
```

**Listing bid / buy-now / order pay — RequireIdempotencyKey:**

```708:716:gateway/internal/router/router.go
			// Pay retry — money mutation: Idempotency-Key required (MON-06/22).
			// Re-enters ChargeListingWinner so auction winners / dismissed-sheet
			// buyers can fund escrow. See listing_orders.go::PayOrder.
			r.With(middleware.RequireIdempotencyKey(cacheClient)).
				Post("/{id}/pay", listingOrdersHandler.PayOrder)
			r.Post("/{id}/confirm-pickup", listingOrdersHandler.ConfirmPickup)
			r.Post("/{id}/file-dispute", listingOrdersHandler.FileListingDispute)
			// Wave 5 polish — mutual handshake + no-show counters.
			r.Post("/{id}/seller-confirm", listingOrdersHandler.SellerConfirm)
```

```750:767:gateway/internal/router/router.go
		// MON-06/22: money-adjacent mutations require Idempotency-Key.
		r.With(middleware.RequireIdempotencyKey(cacheClient)).
			Post("/listings/{id}/bids", listingsHandler.PlaceListingBid)
		// ...
		// See listings_bid.go::BuyItNow. Idempotency-Key required (MON-06/22).
		r.With(middleware.RequireIdempotencyKey(cacheClient)).
			Post("/listings/{id}/buy-now", listingsHandler.BuyItNow)
```

**Bid bond — auth subtree only, no RequireIdempotencyKey:**

```483:489:gateway/internal/router/router.go
		// ── Bid bond pre-auth (anti-fraud) ─────────────────────────────
		// First-time bidders post a Stripe SetupIntent-based bond before
		// their first bid is accepted. The bond is released the moment
		// they complete OR lose the auction (released → trusted forever).
		// Captured on confirmed no-show. eBay/Whatnot ship this; we now do too.
		r.Post("/listings/{id}/bid-bond", bidBondHandler.CreateBidBond)
		r.Post("/listings/{id}/bid-bond/confirm", bidBondHandler.ConfirmBidBond)
```

(These sit under `r.Route("/api/v1", …) { r.Use(authMW.Handler) … }` at router.go:424–425.)

### Listing-bid durable dedup (when key present)

Handler reads the header and passes it into `placeBidTx`; empty key skips DB dedup:

```370:373:gateway/internal/handler/listings_bid.go
	idempotencyKey := r.Header.Get("Idempotency-Key")
	// ...
		r.Context(), id, claims.UserID, req.AmountCents, req.MaxBidCents, idempotencyKey,
```

```504:515:gateway/internal/handler/listings_bid.go
	if idempotencyKey != "" {
		// ...
		err = tx.QueryRow(ctx, `
			SELECT id, amount_cents, created_at, status
			  FROM listing_bids
			 WHERE listing_id = $1 AND bidder_id = $2 AND idempotency_key = $3
			 LIMIT 1`, listingID, bidderID, idempotencyKey,
```

Job bid handler (`gateway/internal/handler/bid.go`) has **no** `idempotency` references — client header is ignored if sent.

### iOS — client headers

```389:416:ios/NoMarkup/Core/APIClient.swift
    /// POST `/api/v1/jobs/{id}/bids` — auth required (provider role on server).
    /// Body: `{ "amount_cents": N }`
    /// Idempotency-Key: `job-bid:{jobId}:{amountCents}:{uuid}` (money-adjacent; safe retries).
    @discardableResult
    func placeJobBid(jobId: String, amountCents: Int64) async throws -> Data {
        let body = AmountCentsBody(amountCents: amountCents)
        let idem = "job-bid:\(jobId):\(amountCents):\(UUID().uuidString)"
        return try await postData(
            pathComponents: ["api", "v1", "jobs", jobId, "bids"],
            body: body,
            authorized: .required,
            headers: ["Idempotency-Key": idem]
        )
    }

    /// POST `/api/v1/listings/{id}/bids` — auth required.
    /// Body: `{ "amount_cents": N }` (optional `max_bid_cents` omitted for MVP).
    /// Idempotency-Key required by gateway middleware (MON-06/22).
    @discardableResult
    func placeListingBid(listingId: String, amountCents: Int64) async throws -> Data {
        let body = AmountCentsBody(amountCents: amountCents)
        // Unique per attempt so intentional re-bids are not blocked as replays.
        let idem = "listing-bid:\(listingId):\(amountCents):\(UUID().uuidString)"
        return try await postData(
            pathComponents: ["api", "v1", "listings", listingId, "bids"],
            body: body,
            authorized: .required,
            headers: ["Idempotency-Key": idem]
        )
    }
```

```480:500:ios/NoMarkup/Core/APIClient.swift
    /// POST `/api/v1/listings/{id}/buy-now` — auth required.
    /// ...
    /// Idempotency-Key: `buy-now:{listingId}` (MON-06/22).
    func buyNow(listingId: String) async throws -> BuyNowResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "buy-now"],
            body: EmptyJSONObject(),
            authorized: .required,
            headers: ["Idempotency-Key": "buy-now:\(listingId)"]
        )
    }

    /// POST `/api/v1/orders/{id}/pay` — mint/resume PI for `pending_payment` orders.
    /// Idempotency-Key: `order-pay:{orderId}`.
    func payOrder(orderId: String) async throws -> PaymentIntentEnvelope {
        try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "pay"],
            body: EmptyJSONObject(),
            authorized: .required,
            headers: ["Idempotency-Key": "order-pay:\(orderId)"]
        )
    }
```

**Bid bond (iOS) — no Idempotency-Key header:**

```220:253:ios/NoMarkup/Core/APIClient+Commerce.swift
    /// POST `/api/v1/listings/{id}/bid-bond` — mint SetupIntent + pending bond row.
    func createListingBidBond(
        listingId: String,
        intendedBidCents: Int64
    ) async throws -> CreateListingBidBondResponse {
        // ...
        return try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "bid-bond"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/listings/{id}/bid-bond/confirm` — flip pending → authorized ...
    func confirmListingBidBond(
        listingId: String,
        bondId: String
    ) async throws -> ConfirmListingBidBondResponse {
        // ...
        return try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "bid-bond", "confirm"],
            body: body,
            authorized: .required
        )
    }
```

### Web — counterpart evidence

| Path | File:line | Header? |
|------|-----------|---------|
| Buy-now | `web/src/hooks/useBuyNow.ts:43–48` | `idempotencyHeader(\`buy-now:${listingId}\`)` |
| Order pay | `web/src/hooks/useOrderPayment.ts:87–91` | `idempotencyHeader(orderPayOperationKey(orderId))` |
| Listing bid | `web/src/hooks/useListings.ts:312–313` | **none** — plain `api.post(.../bids, input)` |
| Job bid | `web/src/hooks/useBids.ts:64–65` | **none** |
| Bid bond | `web/src/hooks/useCompliance.ts:212–225` | **none** |

---

## 2. No force unwraps in iOS money paths

### Search

| Pattern | Result under `ios/` |
|---------|---------------------|
| `try!` | **0 matches** |
| `as!` | **0 matches** |
| `fatalError` | **0 matches** |

### Static `URL(string:)!` only in `AppConfig` (not money)

```12:12:ios/NoMarkup/Core/AppConfig.swift
    static let publicWebBaseURL = URL(string: "https://no-markup.com")!
```

```48:51:ios/NoMarkup/Core/AppConfig.swift
        #if DEBUG && targetEnvironment(simulator)
        return URL(string: "http://localhost:8080")!
        #else
        return URL(string: "https://api.no-markup.com")!
```

These are compile-time-constant URL literals for config defaults, not payment / bid amount paths.

### Money path style

Money mutations use `async throws`, `guard`, optional binding, and typed `Int64` bodies (e.g. `placeJobBid` / `placeListingBid` / `buyNow` / `payOrder` / `createListingBidBond` above). Bid submission UI converts dollars → cents via `MoneyFormat.cents(fromDollarsText:)` optional parse before calling the client.

**Verdict: PASS** for money-path force-unwrap absence.

---

## 3. `iOSHardOffKeys` still enforced (`FeatureFlags.swift`)

```22:52:ios/NoMarkup/Core/FeatureFlags.swift
    /// Flags that must stay OFF in the first App Store binary regardless of server values.
    static let iOSHardOffKeys: Set<String> = [
        "customer_bnpl",
        "working_capital",
        "per_job_insurance",
        "insurance_competition",
        "legal_services",
        "lead_gen",
        "instant_payout",
    ]
    // ...
    /// Effective enablement for product gates.
    /// Hard-off keys always return `false`; all other keys follow the server (default `false` if unknown).
    func isEnabled(_ key: String) -> Bool {
        if Self.iOSHardOffKeys.contains(key) {
            return false
        }
        return serverFlags[key] ?? false
    }
```

Hard-off set is authoritative regardless of `GET /api/v1/flags` (documented at lines 8–10). Matches checklist / device-smoke expectations.

**Verdict: PASS**

---

## 4. Amounts are `Int64` cents, not `Double`, in API bodies

### iOS encode

```1304:1306:ios/NoMarkup/Core/APIClient.swift
private struct AmountCentsBody: Encodable {
    let amountCents: Int64
}
```

JSON encoder uses snake_case (`amount_cents`) at `APIClient.swift:1006–1008`.

Bid bond body:

```302:304:ios/NoMarkup/Core/APIClient+Commerce.swift
private struct CreateListingBidBondBody: Encodable {
    let intendedBidCents: Int64
}
```

Create job / listing also use `Int64` for `startingBidCents` / `startingPriceCents` / `buyNowPriceCents` (`APIClient.swift` create helpers).

### Gateway decode

```93:95:gateway/internal/handler/bid.go
type placeBidRequest struct {
	AmountCents int64 `json:"amount_cents"`
}
```

```102:105:gateway/internal/handler/listings_bid.go
type placeListingBidRequest struct {
	AmountCents    int64  `json:"amount_cents"`
	MaxBidCents    *int64 `json:"max_bid_cents,omitempty"`
}
```

```107:109:gateway/internal/handler/bid_bonds.go
type createBidBondRequest struct {
	IntendedBidCents int64 `json:"intended_bid_cents"`
}
```

No `float64` / `Double` money fields on these request bodies.

**Verdict: PASS**

---

## 5. confirm-pickup / seller-confirm exist and are auth-gated

### Routes (authenticated `/api/v1` group)

```713:716:gateway/internal/router/router.go
			r.Post("/{id}/confirm-pickup", listingOrdersHandler.ConfirmPickup)
			r.Post("/{id}/file-dispute", listingOrdersHandler.FileListingDispute)
			// Wave 5 polish — mutual handshake + no-show counters.
			r.Post("/{id}/seller-confirm", listingOrdersHandler.SellerConfirm)
```

Auth middleware is applied to the entire `/api/v1` protected block (`router.go:424–425` `r.Use(authMW.Handler)`).

### Handler authz — confirm-pickup

```101:106:gateway/internal/handler/listing_orders.go
func (h *ListingOrdersHandler) ConfirmPickup(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
```

```166:168:gateway/internal/handler/listing_orders.go
	if !isAdmin && buyerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the buyer can confirm pickup")
		return
	}
```

### Handler authz — seller-confirm

```294:299:gateway/internal/handler/listing_orders.go
func (h *ListingOrdersHandler) SellerConfirm(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
```

```338:341:gateway/internal/handler/listing_orders.go
	isAdmin := hasRole(claims, "admin")
	if !isAdmin && sellerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the seller can confirm pickup")
		return
	}
```

### iOS clients (Bearer required)

```578:597:ios/NoMarkup/Core/APIClient.swift
    /// POST `/api/v1/orders/{id}/confirm-pickup` — buyer half of the mutual escrow handshake.
    func confirmOrderPickup(orderId: String) async throws -> OrderEscrowActionResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "confirm-pickup"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/orders/{id}/seller-confirm` — seller half of the mutual escrow handshake.
    func sellerConfirmOrder(orderId: String) async throws -> OrderEscrowActionResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "seller-confirm"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }
```

UI: `ios/NoMarkup/Features/MyOrdersView.swift` (`confirmPickup` / `sellerConfirm` tasks).

**Note (by design, not a gap):** Idempotency-Key is **not** required on confirm-pickup / seller-confirm — router comment at `router.go:701–703` states SQL state-machine transitions are themselves idempotent.

**Verdict: PASS**

---

## 6. Remaining gaps (P0 / P1)

### P0

| ID | Gap | Evidence | Exit |
|----|-----|----------|------|
| **SEC-GATE-01** | **Web listing bid omits `Idempotency-Key` while gateway requires it** | `useListings.ts:312–313` vs `router.go:751–752` | Pass `idempotencyHeader(...)` on place-listing-bid (and clear on success); E2E place bid 200 |
| **SEC-GATE-02** | **Open money races MON-14–18** (capture/process, BNPL, advances, dispute transfer stamp, auto-release vs dispute) | `adversarial-action-tracker.md` MON-14…18 **Open**; ADR accepts residual for *web* remediation only | Close each MON row with concurrency tests before live money / enabling hard-off rails |
| **SEC-GATE-03** | **Feature flags fail-closed only for routes that call `RequireFlag`** | Project rule §6 — 7/13 flags UI-only | Either wire enforcement or document “UI-only” per flag before claiming flag-off is API-off |

### P1

| ID | Gap | Evidence | Exit |
|----|-----|----------|------|
| **SEC-GATE-04** | ~~Job bid: gateway does not require Idempotency-Key~~ **CLOSED** middleware | `router.go` job place bid now `authMW` + `RequireIdempotencyKey` | Residual: durable SQL dedup in `bid.go` (listing parity) |
| **SEC-GATE-05** | ~~Web job bid omits Idempotency-Key~~ **CLOSED** | `useBids.ts` `usePlaceBid` + `idempotencyHeader` | — |
| **SEC-GATE-06** | ~~Bid bond create/confirm no middleware / clients~~ **CLOSED** middleware + clients | gateway + iOS Commerce + web useCompliance | Residual: SetupIntent reuse / unique constraint on double-tap |
| **SEC-GATE-07** | iOS job-bid key includes UUID per call → retries of the *same* intentional bid are not sticky | `APIClient.swift` placeJobBid | Stable key per logical attempt (like web `idempotencyHeader(operationKey)`) |
| **SEC-GATE-08** | MON-19…23, MON-26 residual money integrity (award lock, fee policy, tip rail, concurrent refund tests) | adversarial tracker | Next money-integrity sprint |
| **SEC-GATE-09** | gRPC mesh still insecure credentials on private network | Claude.md §6 TLS note | mTLS when provisioning completes |

### Explicit non-gaps (this audit)

- iOS hard-off regulated rails: **enforced**.
- confirm-pickup / seller-confirm: **exist**, **auth + party ownership**.
- Money request bodies: **integer cents**.
- iOS money clients: **no `try!` / `as!` / `fatalError`**.

---

## Commands to re-verify (local)

```bash
# Idempotency middleware on money routes
rg -n 'RequireIdempotencyKey|PlaceBid|buy-now|bid-bond|/pay' gateway/internal/router/router.go

# iOS headers + hard-offs
rg -n 'Idempotency-Key|iOSHardOffKeys|AmountCentsBody|confirm-pickup|seller-confirm' ios/NoMarkup

# Force-unwrap patterns
rg -n 'try!|as!|fatalError' ios/

# Web money headers
rg -n 'idempotencyHeader|Idempotency-Key|/bids|buy-now|bid-bond' web/src/hooks
```

---

## Sign-off

| Role | Status |
|------|--------|
| Static security gate (this doc) | **PASS WITH GAPS** — gaps listed above |
| Live money race suite | **Not re-run this session** — see tracker + ADR |
| Production money launch | **Blocked** until P0 money races + web listing-bid key are closed (or scoped out with flags) |


## Update — web listing bid Idempotency-Key (same day)

`web/src/hooks/useListings.ts` `usePlaceListingBid` now sends `idempotencyHeader('listing-bid:{listingId}:{amount}')` and clears on success. Closes the P0 gap that web omitted the header while gateway required it.

## Update — job bid + bid-bond Idempotency-Key (same day)

Closed **SEC-GATE-04 / 05 / 06** (gateway enforce + client headers):

| Mutation | Gateway | Clients |
|----------|---------|---------|
| Job bid `POST /jobs/{id}/bids` | `authMW` + `RequireIdempotencyKey(cacheClient)` | Web `usePlaceBid` + iOS `placeJobBid` (already sent) |
| Bid bond create | `RequireIdempotencyKey` under auth subtree | Web `useCreateBidBond` + iOS `createListingBidBond` |
| Bid bond confirm | `RequireIdempotencyKey` under auth subtree | Web `useConfirmBidBond` + iOS `confirmListingBidBond` |

Residual: handler-level durable dedup for job bids / bonds (middleware only rejects missing key; listing bids already dedup in SQL). iOS job-bid key still UUID-per-call (SEC-GATE-07).
