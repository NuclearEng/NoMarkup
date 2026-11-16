-- Remove the financial / monetization feature flags seeded by the up migration.
DELETE FROM feature_flags WHERE key IN (
    'customer_bnpl',
    'instant_payout',
    'per_job_insurance',
    'working_capital',
    'lead_gen',
    'insurance_competition',
    'legal_services'
);
