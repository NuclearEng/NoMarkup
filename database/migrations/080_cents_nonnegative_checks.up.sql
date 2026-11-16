-- Migration 080 — reject negative money. Part 1 of 3: declare the constraints.
--
-- ── The defect ───────────────────────────────────────────────────────────
-- 101 columns in this schema are named *_cents. 62 of them accepted negative
-- values. Proven by direct insert against the live schema before this
-- migration: contracts.amount_cents = -999999 was accepted, and a payments row
-- with platform_fee_cents = -50000, provider_payout_cents = -777 and
-- refund_amount_cents = -42 was accepted. Every one of those is a money value
-- the application computes and the database will happily store inverted — a
-- negative platform_fee_cents is the platform paying the provider a bonus, a
-- negative refund_amount_cents is a refund that charges the customer.
--
-- CLAUDE.md §5 already requires money to be BIGINT cents; the missing half is
-- that cents must have a floor. instant_payouts is the in-repo model for doing
-- this properly (CHECK (amount_cents > 0), CHECK (fee_cents >= 0),
-- CHECK (net_cents = amount_cents - fee_cents)); this migration extends the
-- floor half of that pattern across the schema.
--
-- ── The bound chosen: >= 0, not > 0 ──────────────────────────────────────
-- Uniformly `>= 0`. It is the bound the defect actually calls for (the report
-- is about NEGATIVE money) and it cannot reject a legitimate existing row: a
-- zero fee, a zero tip, a zero deductible and a zero balance are all real
-- states this schema already produces via DEFAULT 0. `> 0` would be stricter
-- but would risk failing VALIDATE in 082 on rows that are perfectly correct,
-- which on a populated production table means a wedged deploy for no security
-- gain. Columns that genuinely need `> 0` mostly already have it (39 of the
-- 101 were already constrained and are left untouched).
--
-- ── Columns deliberately SKIPPED — these are signed by design ────────────
--   * change_orders.amount_delta_cents — a DELTA. A change order that reduces
--     scope is a negative delta; that is the column's entire purpose.
--   * referral_credits.amount_cents — a signed LEDGER. Its source CHECK admits
--     'consumed', and gateway/internal/handler/referrals.go computes the user's
--     balance as SUM(amount_cents). A consumption row must be negative or the
--     balance can never go down.
--   * user_savings.savings_cents — a DIFFERENCE (market median minus what the
--     customer actually paid). Negative means the customer paid above market,
--     which is a real and reportable outcome, not corruption. The two inputs it
--     is derived from (awarded_cents, market_median_cents) ARE constrained.
--
-- Considered and NOT skipped:
--   * provider_credit_limits.available_advance_cents — looked like derived
--     headroom that could go negative, but engines/underwriting/src/model.rs:350
--     computes it as `(limit - outstanding).max(0)`. Already clamped at the
--     source; the constraint just makes that guarantee structural.
--   * seller_metrics_daily.gross_cents — gross sales, not net of refunds.
--   * payments.provider_payout_cents / platform_fee_cents / refund_amount_cents
--     — all magnitudes, all computed server-side, none of them signed.
--
-- ── Why NOT VALID here and VALIDATE in 082 ───────────────────────────────
-- `ADD CONSTRAINT ... NOT VALID` records the rule and enforces it on every
-- subsequent INSERT/UPDATE without scanning the table. It takes ACCESS
-- EXCLUSIVE for the catalog write only — microseconds, no table scan — so the
-- 59 statements here are safe to run together in one transaction.
--
-- Combining the ADD and the VALIDATE in one migration would be the trap: the
-- ACCESS EXCLUSIVE lock from the ADD is held until the transaction commits, so
-- a VALIDATE in the same transaction runs its full table scan under ACCESS
-- EXCLUSIVE — a total read AND write outage on every one of these tables at
-- once. Split across migrations, VALIDATE takes only SHARE UPDATE EXCLUSIVE
-- (081/082), which blocks neither reads nor writes.
--
-- Order is 080 declare → 081 repair → 082 validate. The repair must come after
-- the declare so the NOT VALID rule is already blocking NEW negatives while
-- the old ones are being cleaned up, and before the validate so the scan in 082
-- has nothing left to reject. `grep -c CONCURRENTLY database/migrations/*.up.sql`
-- was zero and no migration had ever set lock_timeout before this batch; the
-- deploy Job caps at activeDeadlineSeconds: 600 and golang-migrate stamps
-- dirty=true BEFORE executing, so a blocking migration is not just slow, it
-- wedges the pipeline.
SET lock_timeout = '5s';

ALTER TABLE analytics_transactions
    ADD CONSTRAINT ck_analytics_transactions_amount_cents_nonneg CHECK (amount_cents >= 0) NOT VALID;
ALTER TABLE bids
    ADD CONSTRAINT ck_bids_original_amount_cents_nonneg CHECK (original_amount_cents >= 0) NOT VALID;
ALTER TABLE contracts
    ADD CONSTRAINT ck_contracts_amount_cents_nonneg CHECK (amount_cents >= 0) NOT VALID;
ALTER TABLE contracts
    ADD CONSTRAINT ck_contracts_tip_amount_cents_nonneg CHECK (tip_amount_cents >= 0) NOT VALID;
ALTER TABLE disputes
    ADD CONSTRAINT ck_disputes_guarantee_payout_cents_nonneg CHECK (guarantee_payout_cents >= 0) NOT VALID;
ALTER TABLE disputes
    ADD CONSTRAINT ck_disputes_refund_amount_cents_nonneg CHECK (refund_amount_cents >= 0) NOT VALID;
ALTER TABLE installment_plans
    ADD CONSTRAINT ck_installment_plans_bnpl_fee_cents_nonneg CHECK (bnpl_fee_cents >= 0) NOT VALID;
ALTER TABLE insurance_claims
    ADD CONSTRAINT ck_insurance_claims_approved_amount_cents_nonneg CHECK (approved_amount_cents >= 0) NOT VALID;
ALTER TABLE insurance_claims
    ADD CONSTRAINT ck_insurance_claims_assessed_amount_cents_nonneg CHECK (assessed_amount_cents >= 0) NOT VALID;
ALTER TABLE insurance_claims
    ADD CONSTRAINT ck_insurance_claims_claimed_amount_cents_nonneg CHECK (claimed_amount_cents >= 0) NOT VALID;
ALTER TABLE insurance_claims
    ADD CONSTRAINT ck_insurance_claims_payout_cents_nonneg CHECK (payout_cents >= 0) NOT VALID;
ALTER TABLE insurance_policies
    ADD CONSTRAINT ck_insurance_policies_coverage_amount_cents_nonneg CHECK (coverage_amount_cents >= 0) NOT VALID;
ALTER TABLE insurance_policies
    ADD CONSTRAINT ck_insurance_policies_deductible_cents_nonneg CHECK (deductible_cents >= 0) NOT VALID;
ALTER TABLE insurance_policies
    ADD CONSTRAINT ck_insurance_policies_premium_cents_nonneg CHECK (premium_cents >= 0) NOT VALID;
ALTER TABLE insurance_products
    ADD CONSTRAINT ck_insurance_products_deductible_cents_nonneg CHECK (deductible_cents >= 0) NOT VALID;
ALTER TABLE insurance_products
    ADD CONSTRAINT ck_insurance_products_max_coverage_cents_nonneg CHECK (max_coverage_cents >= 0) NOT VALID;
ALTER TABLE insurance_products
    ADD CONSTRAINT ck_insurance_products_min_premium_cents_nonneg CHECK (min_premium_cents >= 0) NOT VALID;
ALTER TABLE jobs
    ADD CONSTRAINT ck_jobs_hourly_rate_cents_nonneg CHECK (hourly_rate_cents >= 0) NOT VALID;
ALTER TABLE jobs
    ADD CONSTRAINT ck_jobs_lowest_bid_cents_nonneg CHECK (lowest_bid_cents >= 0) NOT VALID;
ALTER TABLE jobs
    ADD CONSTRAINT ck_jobs_offer_accepted_cents_nonneg CHECK (offer_accepted_cents >= 0) NOT VALID;
ALTER TABLE jobs
    ADD CONSTRAINT ck_jobs_starting_bid_cents_nonneg CHECK (starting_bid_cents >= 0) NOT VALID;
ALTER TABLE listing_bids
    ADD CONSTRAINT ck_listing_bids_max_bid_cents_nonneg CHECK (max_bid_cents >= 0) NOT VALID;
ALTER TABLE listing_watchlist
    ADD CONSTRAINT ck_listing_watchlist_baseline_price_cents_nonneg CHECK (baseline_price_cents >= 0) NOT VALID;
ALTER TABLE listing_watchlist
    ADD CONSTRAINT ck_listing_watchlist_last_drop_alert_cents_nonneg CHECK (last_drop_alert_cents >= 0) NOT VALID;
ALTER TABLE listings
    ADD CONSTRAINT ck_listings_current_bid_cents_nonneg CHECK (current_bid_cents >= 0) NOT VALID;
ALTER TABLE market_ranges
    ADD CONSTRAINT ck_market_ranges_high_cents_nonneg CHECK (high_cents >= 0) NOT VALID;
ALTER TABLE market_ranges
    ADD CONSTRAINT ck_market_ranges_low_cents_nonneg CHECK (low_cents >= 0) NOT VALID;
ALTER TABLE market_ranges
    ADD CONSTRAINT ck_market_ranges_median_cents_nonneg CHECK (median_cents >= 0) NOT VALID;
ALTER TABLE marketplace_policies
    ADD CONSTRAINT ck_marketplace_policies_deductible_cents_nonneg CHECK (deductible_cents >= 0) NOT VALID;
ALTER TABLE payments
    ADD CONSTRAINT ck_payments_guarantee_fee_cents_nonneg CHECK (guarantee_fee_cents >= 0) NOT VALID;
ALTER TABLE payments
    ADD CONSTRAINT ck_payments_platform_fee_cents_nonneg CHECK (platform_fee_cents >= 0) NOT VALID;
ALTER TABLE payments
    ADD CONSTRAINT ck_payments_provider_payout_cents_nonneg CHECK (provider_payout_cents >= 0) NOT VALID;
ALTER TABLE payments
    ADD CONSTRAINT ck_payments_refund_amount_cents_nonneg CHECK (refund_amount_cents >= 0) NOT VALID;
ALTER TABLE provider_credit_limits
    ADD CONSTRAINT ck_provider_credit_limits_available_advance_cents_nonneg CHECK (available_advance_cents >= 0) NOT VALID;
ALTER TABLE provider_credit_limits
    ADD CONSTRAINT ck_provider_credit_limits_avg_job_value_cents_nonneg CHECK (avg_job_value_cents >= 0) NOT VALID;
ALTER TABLE provider_credit_limits
    ADD CONSTRAINT ck_provider_credit_limits_max_advance_cents_nonneg CHECK (max_advance_cents >= 0) NOT VALID;
ALTER TABLE provider_credit_limits
    ADD CONSTRAINT ck_provider_credit_limits_total_earnings_cents_nonneg CHECK (total_earnings_cents >= 0) NOT VALID;
ALTER TABLE provider_credit_limits
    ADD CONSTRAINT ck_provider_credit_limits_total_outstanding_cents_nonneg CHECK (total_outstanding_cents >= 0) NOT VALID;
ALTER TABLE provider_profiles
    ADD CONSTRAINT ck_provider_profiles_insurance_coverage_cents_nonneg CHECK (insurance_coverage_cents >= 0) NOT VALID;
ALTER TABLE quote_templates
    ADD CONSTRAINT ck_quote_templates_default_amount_cents_nonneg CHECK (default_amount_cents >= 0) NOT VALID;
ALTER TABLE recurring_instances
    ADD CONSTRAINT ck_recurring_instances_amount_cents_nonneg CHECK (amount_cents >= 0) NOT VALID;
ALTER TABLE referrals
    ADD CONSTRAINT ck_referrals_credit_cents_nonneg CHECK (credit_cents >= 0) NOT VALID;
ALTER TABLE referrals
    ADD CONSTRAINT ck_referrals_referred_credit_cents_nonneg CHECK (referred_credit_cents >= 0) NOT VALID;
ALTER TABLE referrals
    ADD CONSTRAINT ck_referrals_referrer_credit_cents_nonneg CHECK (referrer_credit_cents >= 0) NOT VALID;
ALTER TABLE seller_metrics_daily
    ADD CONSTRAINT ck_seller_metrics_daily_gross_cents_nonneg CHECK (gross_cents >= 0) NOT VALID;
ALTER TABLE seller_tax_forms
    ADD CONSTRAINT ck_seller_tax_forms_federal_tax_withheld_cents_nonneg CHECK (federal_tax_withheld_cents >= 0) NOT VALID;
ALTER TABLE seller_tax_forms
    ADD CONSTRAINT ck_seller_tax_forms_gross_payments_cents_nonneg CHECK (gross_payments_cents >= 0) NOT VALID;
ALTER TABLE seller_tax_forms
    ADD CONSTRAINT ck_seller_tax_forms_state_tax_withheld_cents_nonneg CHECK (state_tax_withheld_cents >= 0) NOT VALID;
ALTER TABLE subscription_tiers
    ADD CONSTRAINT ck_subscription_tiers_annual_price_cents_nonneg CHECK (annual_price_cents >= 0) NOT VALID;
ALTER TABLE subscription_tiers
    ADD CONSTRAINT ck_subscription_tiers_monthly_price_cents_nonneg CHECK (monthly_price_cents >= 0) NOT VALID;
ALTER TABLE subscription_tiers
    ADD CONSTRAINT ck_subscription_tiers_price_cents_nonneg CHECK (price_cents >= 0) NOT VALID;
ALTER TABLE subscriptions
    ADD CONSTRAINT ck_subscriptions_current_price_cents_nonneg CHECK (current_price_cents >= 0) NOT VALID;
ALTER TABLE tax_forms
    ADD CONSTRAINT ck_tax_forms_federal_tax_withheld_cents_nonneg CHECK (federal_tax_withheld_cents >= 0) NOT VALID;
ALTER TABLE tax_forms
    ADD CONSTRAINT ck_tax_forms_state_tax_withheld_cents_nonneg CHECK (state_tax_withheld_cents >= 0) NOT VALID;
ALTER TABLE tax_forms
    ADD CONSTRAINT ck_tax_forms_total_compensation_cents_nonneg CHECK (total_compensation_cents >= 0) NOT VALID;
ALTER TABLE user_savings
    ADD CONSTRAINT ck_user_savings_awarded_cents_nonneg CHECK (awarded_cents >= 0) NOT VALID;
ALTER TABLE user_savings
    ADD CONSTRAINT ck_user_savings_market_median_cents_nonneg CHECK (market_median_cents >= 0) NOT VALID;
ALTER TABLE working_capital_advances
    ADD CONSTRAINT ck_working_capital_advances_fee_cents_nonneg CHECK (fee_cents >= 0) NOT VALID;
ALTER TABLE working_capital_advances
    ADD CONSTRAINT ck_working_capital_advances_repaid_cents_nonneg CHECK (repaid_cents >= 0) NOT VALID;
