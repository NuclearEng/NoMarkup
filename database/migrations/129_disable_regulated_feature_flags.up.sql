-- App Store 3.2 / licenses — review and prod must ship these OFF until live-flagged.
-- 060 seeded some TRUE (customer_bnpl, instant_payout, per_job_insurance, working_capital).

UPDATE feature_flags
   SET enabled = false,
       updated_at = now()
 WHERE key IN (
    'customer_bnpl',
    'working_capital',
    'per_job_insurance',
    'insurance_competition',
    'legal_services',
    'lead_gen',
    'instant_payout'
);
