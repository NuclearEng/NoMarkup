-- Reverse migration 069 — drop the one-active-plan-per-contract invariant.

DROP INDEX IF EXISTS uniq_installment_plans_active_per_contract;
