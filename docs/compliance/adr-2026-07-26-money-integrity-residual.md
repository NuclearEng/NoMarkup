# ADR: Money-integrity residual (MON-14–18) — SUPERSEDED by code close

**Date:** 2026-07-26 (original accept) · **Superseded:** 2026-07-27 (tracker Done) · **Doc reconcile:** 2026-08-02  
**Status:** **SUPERSEDED** — engineering closed; residual is **ops dogfood only**  
**Related ASR:** ASR-2.1.a.4  
**Tracker:** `docs/planning/adversarial-action-tracker.md` MON-14 … MON-18 (**Done** 2026-07-27)

## Supersession summary (read this first)

| Period | Status |
|--------|--------|
| 2026-07-26 | **Accepted residual risk** for App Store *web* remediation exit — races open, time-boxed |
| 2026-07-27 | **Code closed** — each MON-14…18 row marked **Done** with CAS / locks / Stripe keys + concurrency or unit tests |
| 2026-08-02 | This ADR marked **SUPERSEDED**. Do **not** claim MON-14–18 are still open engineering debt. Residual: **live Stripe / staging dogfood** of BNPL, advances, and goods dispute/release under real keys when enabling regulated rails |

The original decision to *accept* residual risk for the 2026-07-26 web remediation slice remains historically correct. It is **no longer** the standing product claim for money-path readiness of these five races.

---

## Context (historical)

The App Store compliance remediation pass closed web-facing product completeness issues (legal docs, UGC safety, insurance evidence upload, privacy consent). At that time the adversarial tracker still listed open **MAJOR** money races:

| ID | Summary | Tracker (2026-07-27) |
|----|---------|----------------------|
| MON-14 | CapturePaymentIntent / ProcessPayment idempotency race | **Done** — `ProcessPayment` CAS pending→processing + `capture:<paymentID>`; `CapturePaymentIntent` requires idem; `TestProcessPayment_Concurrent_ExactlyOneCapture` |
| MON-15 | BNPL provider paid before first customer charge | **Done** — charge-first (`bnpl-first:` / `bnpl-installment:`); provider transfer only after success; empty off-session key rejected; `resolveCustomerStripeID` fail-closed; `charge_failure_does_not_pay_provider` |
| MON-16 | Working capital RequestAdvance credit TOCTOU | **Done** — credit check + CreateAdvance under `WithProviderAdvisoryLock` |
| MON-17 | Goods dispute resolve missing stripe_transfer_id stamp | **Done** — `ResolveListingDispute` uses `listing-release:<orderID>` + `MarkListingOrderTransferred` |
| MON-18 | Goods auto-release vs dispute file race | **Done** — `ClaimListingOrderForDispute` FOR UPDATE freeze; release stamps durable `pending:<orderID>` claim before Stripe; dual-direction race tests |

Closing these required payment-service work and concurrency tests — completed in waves 26–28 (2026-07-27), not in the original web remediation slice.

## Decision (superseded standing)

**Original (2026-07-26):** Accept MON-14–18 as residual risk for web remediation exit only; do not claim race-free money paths until tracker Done.

**Current (2026-07-27+):**

1. **Engineering for MON-14–18 is closed** per adversarial tracker Done evidence (service + repo tests).
2. **Do not** re-open these IDs as “accepted residual risk” in submit / security-gate language without new bug evidence.
3. **Ops residual only:** live Stripe dogfood when enabling BNPL / working capital / goods release-dispute under production-like keys; keep feature flags available to disable regulated rails if licenses or launch constraints require it.
4. iOS packaging may still **flag-gate** `customer_bnpl` / `working_capital` for **license / product** reasons — that is **not** because MON-15/16 code races remain open (see `ios-payment-rails-design.md` + `regulated-rails-live-flagged.md`).

## Consequences

- ASR-2.1.a.4 money-race leg is **code-mitigated** for MON-14–18; insurance blob upload was already fixed in the web remediation pass.
- Compliance reports that still say “MON-14–18 Open / ADR residual” are **stale** — reconcile to tracker Done + this SUPERSEDED note.
- Remaining money/regulated honesty: **R6.x licenses**, flag enablement, founder secrets, live dogfood — not these five race IDs.

## Revisit triggers

- Any production double-charge or double-transfer incident that falsifies a Done claim (file a new tracker ID; do not silently reopen MON-14–18 without evidence)
- Enabling BNPL / advances / goods auto-release in a production storefront without live dogfood
- Regression that removes CAS / FOR UPDATE / Stripe idempotency keys on these paths

## Evidence pointers

| ID | Primary code | Tests |
|----|--------------|-------|
| MON-14 | `services/payment/internal/service/service.go` (ProcessPayment CAS), `stripe.go` | `money_concurrency_test.go` |
| MON-15 | `installment.go` | `installment_test.go` (`charge_failure_does_not_pay_provider`) |
| MON-16 | `advance.go` (`WithProviderAdvisoryLock`) | service-level advance tests |
| MON-17 | `listing_charge.go` (ResolveListingDispute stamp) | `listing_charge_test.go` |
| MON-18 | `listing_charge.go` + `repository/marketplace.go` claims | unit race tests + `payment_cas_integration_test.go` (integration tag) |
