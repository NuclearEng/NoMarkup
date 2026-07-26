# ADR: Accept residual money-integrity races (MON-14–18) for App Store web remediation

**Date:** 2026-07-26  
**Status:** Accepted residual risk (time-boxed)  
**Related ASR:** ASR-2.1.a.4 (partial)  
**Tracker:** `docs/planning/adversarial-action-tracker.md` MON-14 … MON-18

## Context

The App Store compliance remediation pass closed web-facing product completeness issues (legal docs, UGC safety, insurance evidence upload, privacy consent). The adversarial tracker still lists open **MAJOR** money races:

| ID | Summary |
|----|---------|
| MON-14 | CapturePaymentIntent / ProcessPayment idempotency race |
| MON-15 | BNPL provider paid before first customer charge |
| MON-16 | Working capital RequestAdvance credit TOCTOU |
| MON-17 | Goods dispute resolve missing stripe_transfer_id stamp |
| MON-18 | Goods auto-release vs dispute file race |

Closing these correctly requires dedicated payment-service work, concurrency tests, and careful Stripe key design — larger than this remediation slice and outside the “web compliance surface” (legal/UGC/privacy).

## Decision

1. **Accept** MON-14–18 as **accepted residual risk** for the purpose of the 2026-07-26 App Store *web* remediation exit criteria.
2. **Do not** claim App Store / production money paths are race-free until each MON row is `Done` in the adversarial tracker.
3. **Owner:** payment service maintainers. **Target:** next money-integrity sprint; keep feature flags available to disable BNPL / working capital / instant payout if needed for a constrained launch.
4. For **iOS packaging**, continue to flag-off `customer_bnpl` and `working_capital` until MON-15/16 are fixed (see `ios-payment-rails-design.md`).

## Consequences

- ASR-2.1.a.4 is **partially mitigated** (insurance blob upload fixed; marketing/legal complete) but **not fully PASS** on money races.
- Compliance report readiness for **web product policy surface** can be READY WITH FOLLOW-UPS; money races remain an engineering follow-up, not a fake PASS.

## Revisit triggers

- Any production double-charge or double-transfer incident
- Enabling BNPL / advances in a production storefront
- App Store binary submission with money features on
