-- Migration 069 — at most ONE active BNPL installment plan per contract.
--
-- Builds on:
--   021 — installment_plans creation (status: active/completed/defaulted/cancelled)
--
-- The money bug this closes:
--   CreateInstallmentPlan pays the provider IN FULL the moment a plan is created.
--   Nothing server-side stopped a customer from creating a SECOND plan for the
--   same contract — only the web UI hid the selector once a plan existed. A
--   direct API call (or a double-submit race) could therefore create N plans for
--   one contract and pay the provider N times for a single job, with the customer
--   on the hook for N installment schedules. Per the project's fail-closed rule,
--   the invariant must live at the data boundary, not the client.
--
-- A PARTIAL UNIQUE index keyed on contract_id WHERE status = 'active' enforces
-- this atomically (it also defeats the concurrent double-submit race a service
-- check alone cannot). A plan that later completes/defaults/cancels frees the
-- contract, so a customer can legitimately set up a fresh plan if one is ever
-- needed again.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_installment_plans_active_per_contract
    ON installment_plans (contract_id)
    WHERE status = 'active';
