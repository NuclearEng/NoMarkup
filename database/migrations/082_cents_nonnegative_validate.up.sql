-- Migration 082 — reject negative money. Part 3 of 3: validate.
--
-- 080 declared the 59 CHECK constraints NOT VALID (enforced on new writes, no
-- table scan). 081 quarantined and clamped every pre-existing negative value so
-- there is nothing left to reject. This migration promotes each constraint to
-- fully validated, which is what makes it trustworthy to the planner and to any
-- future reader of the schema.
--
-- ── Locking ──────────────────────────────────────────────────────────────
-- `ALTER TABLE ... VALIDATE CONSTRAINT` takes SHARE UPDATE EXCLUSIVE on the
-- table. That blocks other DDL, VACUUM and index builds — it does NOT block
-- SELECT, INSERT, UPDATE or DELETE. So this migration scans every listed table
-- once while the application keeps serving reads and writes normally. This is
-- the entire reason 080 and 082 are separate files: run in one transaction, the
-- ACCESS EXCLUSIVE lock from 080's ADD would still be held during these scans
-- and the whole set of tables would be unavailable.
--
-- Duration is proportional to table size (a sequential scan per constraint,
-- several per table for payments/contracts/listings). Against the deploy Job's
-- activeDeadlineSeconds: 600 this is the migration in this batch most likely to
-- need a longer budget on a large database — but a timeout here is recoverable
-- (`migrate force 81` then re-run) and, unlike a blocking ADD+VALIDATE, it
-- costs no availability while it runs.
--
-- lock_timeout guards only the moment of lock acquisition, not the scan.
SET lock_timeout = '5s';

ALTER TABLE analytics_transactions VALIDATE CONSTRAINT ck_analytics_transactions_amount_cents_nonneg;
ALTER TABLE bids VALIDATE CONSTRAINT ck_bids_original_amount_cents_nonneg;
ALTER TABLE contracts VALIDATE CONSTRAINT ck_contracts_amount_cents_nonneg;
ALTER TABLE contracts VALIDATE CONSTRAINT ck_contracts_tip_amount_cents_nonneg;
ALTER TABLE disputes VALIDATE CONSTRAINT ck_disputes_guarantee_payout_cents_nonneg;
ALTER TABLE disputes VALIDATE CONSTRAINT ck_disputes_refund_amount_cents_nonneg;
ALTER TABLE installment_plans VALIDATE CONSTRAINT ck_installment_plans_bnpl_fee_cents_nonneg;
ALTER TABLE insurance_claims VALIDATE CONSTRAINT ck_insurance_claims_approved_amount_cents_nonneg;
ALTER TABLE insurance_claims VALIDATE CONSTRAINT ck_insurance_claims_assessed_amount_cents_nonneg;
ALTER TABLE insurance_claims VALIDATE CONSTRAINT ck_insurance_claims_claimed_amount_cents_nonneg;
ALTER TABLE insurance_claims VALIDATE CONSTRAINT ck_insurance_claims_payout_cents_nonneg;
ALTER TABLE insurance_policies VALIDATE CONSTRAINT ck_insurance_policies_coverage_amount_cents_nonneg;
ALTER TABLE insurance_policies VALIDATE CONSTRAINT ck_insurance_policies_deductible_cents_nonneg;
ALTER TABLE insurance_policies VALIDATE CONSTRAINT ck_insurance_policies_premium_cents_nonneg;
ALTER TABLE insurance_products VALIDATE CONSTRAINT ck_insurance_products_deductible_cents_nonneg;
ALTER TABLE insurance_products VALIDATE CONSTRAINT ck_insurance_products_max_coverage_cents_nonneg;
ALTER TABLE insurance_products VALIDATE CONSTRAINT ck_insurance_products_min_premium_cents_nonneg;
ALTER TABLE jobs VALIDATE CONSTRAINT ck_jobs_hourly_rate_cents_nonneg;
ALTER TABLE jobs VALIDATE CONSTRAINT ck_jobs_lowest_bid_cents_nonneg;
ALTER TABLE jobs VALIDATE CONSTRAINT ck_jobs_offer_accepted_cents_nonneg;
ALTER TABLE jobs VALIDATE CONSTRAINT ck_jobs_starting_bid_cents_nonneg;
ALTER TABLE listing_bids VALIDATE CONSTRAINT ck_listing_bids_max_bid_cents_nonneg;
ALTER TABLE listing_watchlist VALIDATE CONSTRAINT ck_listing_watchlist_baseline_price_cents_nonneg;
ALTER TABLE listing_watchlist VALIDATE CONSTRAINT ck_listing_watchlist_last_drop_alert_cents_nonneg;
ALTER TABLE listings VALIDATE CONSTRAINT ck_listings_current_bid_cents_nonneg;
ALTER TABLE market_ranges VALIDATE CONSTRAINT ck_market_ranges_high_cents_nonneg;
ALTER TABLE market_ranges VALIDATE CONSTRAINT ck_market_ranges_low_cents_nonneg;
ALTER TABLE market_ranges VALIDATE CONSTRAINT ck_market_ranges_median_cents_nonneg;
ALTER TABLE marketplace_policies VALIDATE CONSTRAINT ck_marketplace_policies_deductible_cents_nonneg;
ALTER TABLE payments VALIDATE CONSTRAINT ck_payments_guarantee_fee_cents_nonneg;
ALTER TABLE payments VALIDATE CONSTRAINT ck_payments_platform_fee_cents_nonneg;
ALTER TABLE payments VALIDATE CONSTRAINT ck_payments_provider_payout_cents_nonneg;
ALTER TABLE payments VALIDATE CONSTRAINT ck_payments_refund_amount_cents_nonneg;
ALTER TABLE provider_credit_limits VALIDATE CONSTRAINT ck_provider_credit_limits_available_advance_cents_nonneg;
ALTER TABLE provider_credit_limits VALIDATE CONSTRAINT ck_provider_credit_limits_avg_job_value_cents_nonneg;
ALTER TABLE provider_credit_limits VALIDATE CONSTRAINT ck_provider_credit_limits_max_advance_cents_nonneg;
ALTER TABLE provider_credit_limits VALIDATE CONSTRAINT ck_provider_credit_limits_total_earnings_cents_nonneg;
ALTER TABLE provider_credit_limits VALIDATE CONSTRAINT ck_provider_credit_limits_total_outstanding_cents_nonneg;
ALTER TABLE provider_profiles VALIDATE CONSTRAINT ck_provider_profiles_insurance_coverage_cents_nonneg;
ALTER TABLE quote_templates VALIDATE CONSTRAINT ck_quote_templates_default_amount_cents_nonneg;
ALTER TABLE recurring_instances VALIDATE CONSTRAINT ck_recurring_instances_amount_cents_nonneg;
ALTER TABLE referrals VALIDATE CONSTRAINT ck_referrals_credit_cents_nonneg;
ALTER TABLE referrals VALIDATE CONSTRAINT ck_referrals_referred_credit_cents_nonneg;
ALTER TABLE referrals VALIDATE CONSTRAINT ck_referrals_referrer_credit_cents_nonneg;
ALTER TABLE seller_metrics_daily VALIDATE CONSTRAINT ck_seller_metrics_daily_gross_cents_nonneg;
ALTER TABLE seller_tax_forms VALIDATE CONSTRAINT ck_seller_tax_forms_federal_tax_withheld_cents_nonneg;
ALTER TABLE seller_tax_forms VALIDATE CONSTRAINT ck_seller_tax_forms_gross_payments_cents_nonneg;
ALTER TABLE seller_tax_forms VALIDATE CONSTRAINT ck_seller_tax_forms_state_tax_withheld_cents_nonneg;
ALTER TABLE subscription_tiers VALIDATE CONSTRAINT ck_subscription_tiers_annual_price_cents_nonneg;
ALTER TABLE subscription_tiers VALIDATE CONSTRAINT ck_subscription_tiers_monthly_price_cents_nonneg;
ALTER TABLE subscription_tiers VALIDATE CONSTRAINT ck_subscription_tiers_price_cents_nonneg;
ALTER TABLE subscriptions VALIDATE CONSTRAINT ck_subscriptions_current_price_cents_nonneg;
ALTER TABLE tax_forms VALIDATE CONSTRAINT ck_tax_forms_federal_tax_withheld_cents_nonneg;
ALTER TABLE tax_forms VALIDATE CONSTRAINT ck_tax_forms_state_tax_withheld_cents_nonneg;
ALTER TABLE tax_forms VALIDATE CONSTRAINT ck_tax_forms_total_compensation_cents_nonneg;
ALTER TABLE user_savings VALIDATE CONSTRAINT ck_user_savings_awarded_cents_nonneg;
ALTER TABLE user_savings VALIDATE CONSTRAINT ck_user_savings_market_median_cents_nonneg;
ALTER TABLE working_capital_advances VALIDATE CONSTRAINT ck_working_capital_advances_fee_cents_nonneg;
ALTER TABLE working_capital_advances VALIDATE CONSTRAINT ck_working_capital_advances_repaid_cents_nonneg;
