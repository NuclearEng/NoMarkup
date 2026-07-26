-- Revert body_url to the historical seed path from 043_compliance_bid_bonds.
-- Note: /legal/terms never hosted a ToS document; down is for migration symmetry only.

UPDATE tos_versions
   SET body_url = '/legal/terms'
 WHERE body_url = '/terms';
