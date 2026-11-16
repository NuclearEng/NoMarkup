# Migration Notes

Operational notes on the `database/migrations` chain that don't fit in a SQL
comment. Policy source of truth: `CLAUDE.md` §5 — one operation per migration,
every migration has a down, **never edit a deployed migration**.

Deployment context for everything below: **production has never applied any
migration** (`deploy.yml` is a gated placeholder), so "deployed" currently
means *merged and shared with other developers*. golang-migrate does not
checksum applied files, so an in-place edit does not dirty existing dev
databases — but it can silently diverge fresh databases from old ones, which
is why each accepted edit is logged here.

## Migration edit log

Audit date: 2026-06-10 (branch `fix/security-audit-2026-04-23`).

### 001_initial_schema.up.sql — comment-only edit — ACCEPTED, kept

- Commit `e64f614` changed the header comment `All IDs are UUID v7
  (time-sortable)` → `All IDs are UUID v4 (gen_random_uuid())`.
- Zero schema effect (comment only), and the new comment is the factually
  correct one — the schema has always used `gen_random_uuid()` (v4).
  Reverting would reinstate a wrong comment. Accepted as-is; logged here so
  the policy deviation is on record.

### 003_device_tokens.up.sql — substantive edit — REMEDIATED

- Commit `e64f614` edited the already-shared 003 (introduced in `4a0063e`)
  in place, adding an `updated_at` column and the
  `set_device_tokens_updated_at` trigger.
- Remediation (2026-06-10): 003 restored to its as-introduced content
  (`git show 4a0063e:database/migrations/003_device_tokens.up.sql`); the
  column + trigger now ship as **073_device_tokens_updated_at**, written
  idempotently (`ADD COLUMN IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` +
  `CREATE`) because dev databases that ran the edited 003 already have both
  objects — 073 no-ops there and creates them on fresh chains. 073's down
  drops the trigger + column but **not** `trigger_set_updated_at()`, which
  is owned by 001 and shared by many tables.

### 062_provider_licenses.up.sql / .down.sql — in-place repair — ACCEPTED

- As merged, 062's fixture INSERTs referenced rows that exist **only in the
  original dev database**: seed-tool users (`…0001`–`…0004`, created by
  `database/cmd/seed`, not by migrations) and hardcoded
  `service_categories` UUIDs (006 generates fresh category UUIDs per
  database). Result: every fresh-database bootstrap (CI, prod, new dev)
  failed dirty at version 62 on an FK violation.
- Repair (2026-06-10), done **in place** as an accepted policy deviation
  (prod never ran it; golang-migrate doesn't checksum; a follow-up migration
  cannot fix a chain that dies *at* 62): both fixture INSERTs are now
  existence-guarded (`INSERT … SELECT … WHERE EXISTS` against `users` +
  `service_categories`, plus `NOT EXISTS` on the natural keys
  `(provider_id, license_type, jurisdiction)` and `(customer_id, title)`).
  Identical effect on the dev DB; clean no-op on fresh databases. The down's
  cleanup DELETE now matches the legal category by slug instead of the
  dev-only UUID.
- The fixtures (2 verified WA bar licenses, 2 active legal jobs) were also
  ported to `database/cmd/seed` (§5b in `main.go`), guarded on the same
  natural keys so migration and seeder compose without double-inserting in
  either order. **Rule going forward: demo/fixture data belongs in the seed
  tool, not in migrations; migrations must never reference seed-tool rows
  unguarded.**
