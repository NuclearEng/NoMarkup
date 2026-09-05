-- Down for 080. Drops the 59 non-negativity constraints declared by the up.
--
-- Fully reversible — dropping a CHECK is a catalog-only operation. Note that
-- 081's data repair is NOT reversed by this (see 081's down): the negative
-- values it clamped stay clamped, and their originals stay in
-- negative_cents_quarantine.
--
-- Rolling this back re-opens the schema to negative money: a negative
-- platform_fee_cents, a negative refund_amount_cents, a negative contract
-- amount. Development only.
SET lock_timeout = '5s';

ALTER TABLE analytics_transactions DROP CONSTRAINT IF EXISTS ck_analytics_transactions_amount_cents_nonneg;
ALTER TABLE bids DROP CONSTRAINT IF EXISTS ck_bids_original_amount_cents_nonneg;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ck_contracts_amount_cents_nonneg;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ck_contracts_tip_amount_cents_nonneg;
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS ck_disputes_guarantee_payout_cents_nonneg;
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS ck_disputes_refund_amount_cents_nonneg;
ALTER TABLE installment_plans DROP CONSTRAINT IF EXISTS ck_installment_plans_bnpl_fee_cents_nonneg;
ALTER TABLE insurance_claims DROP CONSTRAINT IF EXISTS ck_insurance_claims_approved_amount_cents_nonneg;
ALTER TABLE insurance_claims DROP CONSTRAINT IF EXISTS ck_insurance_claims_assessed_amount_cents_nonneg;
ALTER TABLE insurance_claims DROP CONSTRAINT IF EXISTS ck_insurance_claims_claimed_amount_cents_nonneg;
ALTER TABLE insurance_claims DROP CONSTRAINT IF EXISTS ck_insurance_claims_payout_cents_nonneg;
ALTER TABLE insurance_policies DROP CONSTRAINT IF EXISTS ck_insurance_policies_coverage_amount_cents_nonneg;
ALTER TABLE insurance_policies DROP CONSTRAINT IF EXISTS ck_insurance_policies_deductible_cents_nonneg;
ALTER TABLE insurance_policies DROP CONSTRAINT IF EXISTS ck_insurance_policies_premium_cents_nonneg;
ALTER TABLE insurance_products DROP CONSTRAINT IF EXISTS ck_insurance_products_deductible_cents_nonneg;
ALTER TABLE insurance_products DROP CONSTRAINT IF EXISTS ck_insurance_products_max_coverage_cents_nonneg;
ALTER TABLE insurance_products DROP CONSTRAINT IF EXISTS ck_insurance_products_min_premium_cents_nonneg;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS ck_jobs_hourly_rate_cents_nonneg;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS ck_jobs_lowest_bid_cents_nonneg;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS ck_jobs_offer_accepted_cents_nonneg;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS ck_jobs_starting_bid_cents_nonneg;
ALTER TABLE listing_bids DROP CONSTRAINT IF EXISTS ck_listing_bids_max_bid_cents_nonneg;
ALTER TABLE listing_watchlist DROP CONSTRAINT IF EXISTS ck_listing_watchlist_baseline_price_cents_nonneg;
ALTER TABLE listing_watchlist DROP CONSTRAINT IF EXISTS ck_listing_watchlist_last_drop_alert_cents_nonneg;
ALTER TABLE listings DROP CONSTRAINT IF EXISTS ck_listings_current_bid_cents_nonneg;
ALTER TABLE market_ranges DROP CONSTRAINT IF EXISTS ck_market_ranges_high_cents_nonneg;
ALTER TABLE market_ranges DROP CONSTRAINT IF EXISTS ck_market_ranges_low_cents_nonneg;
ALTER TABLE market_ranges DROP CONSTRAINT IF EXISTS ck_market_ranges_median_cents_nonneg;
ALTER TABLE marketplace_policies DROP CONSTRAINT IF EXISTS ck_marketplace_policies_deductible_cents_nonneg;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_guarantee_fee_cents_nonneg;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_platform_fee_cents_nonneg;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_provider_payout_cents_nonneg;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_refund_amount_cents_nonneg;
ALTER TABLE provider_credit_limits DROP CONSTRAINT IF EXISTS ck_provider_credit_limits_available_advance_cents_nonneg;
ALTER TABLE provider_credit_limits DROP CONSTRAINT IF EXISTS ck_provider_credit_limits_avg_job_value_cents_nonneg;
ALTER TABLE provider_credit_limits DROP CONSTRAINT IF EXISTS ck_provider_credit_limits_max_advance_cents_nonneg;
ALTER TABLE provider_credit_limits DROP CONSTRAINT IF EXISTS ck_provider_credit_limits_total_earnings_cents_nonneg;
ALTER TABLE provider_credit_limits DROP CONSTRAINT IF EXISTS ck_provider_credit_limits_total_outstanding_cents_nonneg;
ALTER TABLE provider_profiles DROP CONSTRAINT IF EXISTS ck_provider_profiles_insurance_coverage_cents_nonneg;
ALTER TABLE quote_templates DROP CONSTRAINT IF EXISTS ck_quote_templates_default_amount_cents_nonneg;
ALTER TABLE recurring_instances DROP CONSTRAINT IF EXISTS ck_recurring_instances_amount_cents_nonneg;
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS ck_referrals_credit_cents_nonneg;
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS ck_referrals_referred_credit_cents_nonneg;
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS ck_referrals_referrer_credit_cents_nonneg;
ALTER TABLE seller_metrics_daily DROP CONSTRAINT IF EXISTS ck_seller_metrics_daily_gross_cents_nonneg;
ALTER TABLE seller_tax_forms DROP CONSTRAINT IF EXISTS ck_seller_tax_forms_federal_tax_withheld_cents_nonneg;
ALTER TABLE seller_tax_forms DROP CONSTRAINT IF EXISTS ck_seller_tax_forms_gross_payments_cents_nonneg;
ALTER TABLE seller_tax_forms DROP CONSTRAINT IF EXISTS ck_seller_tax_forms_state_tax_withheld_cents_nonneg;
ALTER TABLE subscription_tiers DROP CONSTRAINT IF EXISTS ck_subscription_tiers_annual_price_cents_nonneg;
ALTER TABLE subscription_tiers DROP CONSTRAINT IF EXISTS ck_subscription_tiers_monthly_price_cents_nonneg;
ALTER TABLE subscription_tiers DROP CONSTRAINT IF EXISTS ck_subscription_tiers_price_cents_nonneg;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS ck_subscriptions_current_price_cents_nonneg;
ALTER TABLE tax_forms DROP CONSTRAINT IF EXISTS ck_tax_forms_federal_tax_withheld_cents_nonneg;
ALTER TABLE tax_forms DROP CONSTRAINT IF EXISTS ck_tax_forms_state_tax_withheld_cents_nonneg;
ALTER TABLE tax_forms DROP CONSTRAINT IF EXISTS ck_tax_forms_total_compensation_cents_nonneg;
ALTER TABLE user_savings DROP CONSTRAINT IF EXISTS ck_user_savings_awarded_cents_nonneg;
ALTER TABLE user_savings DROP CONSTRAINT IF EXISTS ck_user_savings_market_median_cents_nonneg;
ALTER TABLE working_capital_advances DROP CONSTRAINT IF EXISTS ck_working_capital_advances_fee_cents_nonneg;
ALTER TABLE working_capital_advances DROP CONSTRAINT IF EXISTS ck_working_capital_advances_repaid_cents_nonneg;
