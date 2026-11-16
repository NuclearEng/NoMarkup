-- Revert CHECK to original 001 set. Rows already migrated to drivers_license
-- are mapped back to government_id so the tighter constraint still holds.

ALTER TABLE verification_documents
  DROP CONSTRAINT IF EXISTS verification_documents_document_type_check;

UPDATE verification_documents
SET document_type = 'government_id'
WHERE document_type = 'drivers_license';

ALTER TABLE verification_documents
  ADD CONSTRAINT verification_documents_document_type_check
  CHECK (document_type IN (
    'government_id',
    'business_license',
    'ein',
    'insurance',
    'trade_license',
    'background_check'
  ));
