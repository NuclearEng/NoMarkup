-- Seed feature flags for the financial / monetization features so that the
-- RequireFlag gateway middleware can gate them. Defaults preserve current
-- behavior: features that work in production today are enabled; not-yet-built
-- or future-phase features are off.
--
-- ON CONFLICT (key) DO NOTHING so this never clobbers a choice an admin made
-- later through the admin dashboard — it only fills in rows that are missing.
INSERT INTO feature_flags (key, enabled, description) VALUES
    ('customer_bnpl',         true,  'Customer Buy-Now-Pay-Later installment plans at checkout'),
    ('instant_payout',        true,  'Provider instant payout of escrowed funds via Stripe'),
    ('per_job_insurance',     true,  'Per-job insurance quotes, purchase, and claims'),
    ('working_capital',       true,  'Provider working-capital advances against pending payouts'),
    ('lead_gen',              false, 'Paid lead-generation marketplace for providers'),
    ('insurance_competition', false, 'Competitive multi-carrier insurance quotes (future phase)'),
    ('legal_services',        false, 'In-platform legal services marketplace (future phase)')
ON CONFLICT (key) DO NOTHING;
