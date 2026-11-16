-- Restore 060 seed defaults: customer_bnpl / instant_payout / per_job_insurance /
-- working_capital true; lead_gen / insurance_competition / legal_services false.

UPDATE feature_flags
   SET enabled = CASE key
        WHEN 'customer_bnpl' THEN true
        WHEN 'instant_payout' THEN true
        WHEN 'per_job_insurance' THEN true
        WHEN 'working_capital' THEN true
        WHEN 'lead_gen' THEN false
        WHEN 'insurance_competition' THEN false
        WHEN 'legal_services' THEN false
       END,
       updated_at = now()
 WHERE key IN (
    'customer_bnpl',
    'instant_payout',
    'per_job_insurance',
    'working_capital',
    'lead_gen',
    'insurance_competition',
    'legal_services'
);
