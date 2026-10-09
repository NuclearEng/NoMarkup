-- Align verification_documents.document_type with user-service wire values
-- (drivers_license / insurance) used by iOS + Go domain, while keeping legacy
-- aliases readable. Migrates historical government_id rows to drivers_license.

ALTER TABLE verification_documents
  DROP CONSTRAINT IF EXISTS verification_documents_document_type_check;

UPDATE verification_documents
SET document_type = 'drivers_license'
WHERE document_type = 'government_id';

UPDATE verification_documents
SET document_type = 'insurance'
WHERE document_type = 'proof_of_insurance';

ALTER TABLE verification_documents
  ADD CONSTRAINT verification_documents_document_type_check
  CHECK (document_type IN (
    'drivers_license',
    'government_id', -- legacy alias (normalized on write in user service)
    'business_license',
    'ein',
    'insurance',
    'trade_license',
    'background_check'
  ));
