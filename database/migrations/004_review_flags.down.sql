-- Rollback: Remove review_flags table and all associated indexes/triggers
DROP TABLE IF EXISTS review_flags CASCADE;
