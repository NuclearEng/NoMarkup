-- Remove the background_checks feature flag, then drop the check store.
DELETE FROM feature_flags WHERE key = 'background_checks';

DROP TABLE IF EXISTS provider_background_checks;
