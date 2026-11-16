-- Point tos_versions.body_url at the public Terms of Service page (/terms).
-- /legal is the attorney marketplace product surface, not the ToS document.
-- ASR / App Store: ToS body_url fix (was incorrectly /legal/terms or NULL).

UPDATE tos_versions
   SET body_url = '/terms'
 WHERE body_url = '/legal/terms'
    OR body_url IS NULL;
