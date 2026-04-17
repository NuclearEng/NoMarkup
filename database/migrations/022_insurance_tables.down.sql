DROP TRIGGER IF EXISTS trg_insurance_claims_updated_at ON insurance_claims;
DROP TRIGGER IF EXISTS trg_insurance_policies_updated_at ON insurance_policies;
DROP TRIGGER IF EXISTS trg_insurance_products_updated_at ON insurance_products;
DROP FUNCTION IF EXISTS update_insurance_updated_at();

DROP TABLE IF EXISTS insurance_claims;
DROP TABLE IF EXISTS insurance_policies;
DROP TABLE IF EXISTS insurance_products;

DROP SEQUENCE IF EXISTS insurance_claim_number_seq;
DROP SEQUENCE IF EXISTS insurance_policy_number_seq;
