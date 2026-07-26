-- Migration 099 — company_employees.ssn_last_four is NOT encrypted. Say so.
--
-- Builds on:
--   012 — created company_employees with the line
--           ssn_last_four TEXT, -- encrypted, last 4 digits only
--   033 — recorded that the column was skipped, in a migration header nobody
--         reads when they are looking at the table
--
-- ── The defect ───────────────────────────────────────────────────────────
-- The 012 comment asserts the column is encrypted. It never has been. The
-- column appears in neither 031's nor 033's flag set, company_employees has no
-- pii_encrypted_v1 column at all, and database/cmd/encrypt-pii does not touch
-- the table. A comment that claims a security property the code does not
-- provide is the exact class of defect this work stream is closing: it is worse
-- than no comment, because it retires the question.
--
-- 012 is deployed and must not be edited (CLAUDE.md §5, forward-only). A `--`
-- comment inside a shipped .sql file is also invisible to anyone inspecting the
-- live database. So the correction is issued as a COMMENT ON COLUMN, which is
-- durable, queryable (\d+ company_employees), and travels with the schema.
--
-- ── Why correct the comment instead of encrypting the column ─────────────
-- Encrypting was considered and rejected on four grounds:
--
--  1. There is nothing to encrypt. company_employees is referenced by ZERO
--     lines of Go, TypeScript or Rust in this repository — verified by
--     grepping the whole tree — and the table is empty. A backfill would
--     encrypt nothing.
--
--  2. There would be no read path to decrypt it and no write path to encrypt
--     new rows. That is precisely the failure this migration's sibling (098)
--     exists to fix for ein_tin: a column declared encrypted whose runtime
--     path silently writes plaintext. Repeating that shape on a dormant table
--     would manufacture a fresh instance of the same bug, untested because
--     there is no code to test.
--
--  3. Last-4-only is already the redacted form. A full SSN is a direct
--     identifier; the last four digits alone are the truncation the IRS and
--     the card networks specify precisely BECAUSE it is not sufficient to
--     identify or impersonate someone on its own. The residual risk of
--     storing it in plaintext is real but an order of magnitude below that of
--     ein_tin (a live business tax identifier) or a full service address.
--
--  4. The right time to make this decision is when the table is wired up, with
--     the actual read/write paths in hand. Encoding a guess now would freeze
--     the wrong answer behind a migration nobody can edit.
--
-- What this migration DOES guarantee is that the next person to touch the table
-- cannot miss the obligation: the requirement is recorded on the column itself,
-- and 098's pii_plaintext_audit view deliberately does not cover this table, so
-- "the audit is clean" can never be mistaken for "this column is protected".
--
-- This migration touches no data. It is comment-only, therefore trivially
-- reversible and incapable of losing anything.

SET lock_timeout = '5s';

COMMENT ON COLUMN company_employees.ssn_last_four IS
    'NOT ENCRYPTED — plaintext. Corrects migration 012, whose inline comment wrongly claimed "encrypted". This column is in neither 031 nor 033, company_employees has no pii_encrypted_v1 flag, and database/cmd/encrypt-pii does not process this table. Storing only the last four digits is itself the redaction. BEFORE WIRING THIS TABLE UP: decide explicitly whether to encrypt (add a pii_encrypted_v1 flag, a spec entry in database/cmd/encrypt-pii, and cipher calls on the read/write paths) or to keep it truncated-plaintext, and update this comment to match reality. See migration 099.';

COMMENT ON COLUMN company_employees.date_of_birth IS
    'NOT ENCRYPTED — plaintext. Unused table; see the ssn_last_four comment. A full DOB is a stronger identifier than a truncated SSN and should be revisited at the same time.';

COMMENT ON COLUMN company_employees.email IS
    'NOT ENCRYPTED — plaintext. Unused table. Note the sibling table provider_employees DOES encrypt email (migration 033); if this table is ever wired up, match that treatment.';

COMMENT ON COLUMN company_employees.phone IS
    'NOT ENCRYPTED — plaintext. Unused table. provider_employees.phone IS encrypted (migration 033); match that treatment if this table is wired up.';

COMMENT ON TABLE company_employees IS
    'DORMANT as of migration 099: referenced by no application code (Go, TypeScript or Rust) and empty. Its PII columns (ssn_last_four, date_of_birth, email, phone, license_number, insurance_policy_number) are PLAINTEXT and are NOT covered by the encrypt-pii backfill or the pii_plaintext_audit view. The live equivalent is provider_employees, which IS encrypted (migration 033). Resolve the encryption question before storing a single real row here.';
