# Flaky-test audit (2026-11-16)

Audit of sleeps, retries and skips in tests against the flaky-test policy in CLAUDE.md
(Verification Discipline): no sleeps, retries or skips to make a test pass; fix the root cause or
delete the test with a written reason. Checklist item RC-43 (`docs/reliability-checklist.md`) flags new
occurrences in a diff.

Searched: `retries`, `test.skip` / `it.skip` / `describe.skip` / `.fixme` / `.todo`, `waitForTimeout`,
`time.Sleep`, `t.Skip*`, `#[ignore]`, `thread::sleep` / `tokio::time::sleep`, `XCTSkip`, retry
loops and `Eventually` in `web/tests`, every Go `*_test.go`, `engines/` and `ios/`.

## Fixed in this change

| Where | What it was | Fix |
|---|---|---|
| `services/user/internal/domain/geo_test.go:317` | `TestParseExactPointAcceptsNaN` documented a gap that `geo.go` has since closed, so it skipped on every run | Deleted (its own skip message said to); `"NaN,…"` / `"…,NaN"` added as rejection cases in both the user and job `TestParseExactPointRejects` |
| `gateway/internal/handler/bid_bonds_test.go:116` | `TestCreateBidBondMissingClaims`: unconditional `t.Skip`, no body | Deleted — it could never run without a pool and asserted nothing |
| `services/user/internal/domain/geo_golden_test.go:52`, `services/job/…/geo_golden_test.go:52`, `database/cmd/encrypt-pii/geo_golden_test.go:52` | Skipped when `testdata/geo_coarsen_golden.csv` was not found — the cross-copy guard would silently stop running if the file moved | `t.Fatal`: the vectors are committed |
| `web/tests/unit/components/bids/AuctionReplay.test.tsx:214,230,327` | Fixed 500 ms / 500 ms / 1000 ms real-time sleeps before asserting playback finished | `findByText('COMPLETE' / 'Auction Complete')` with a bounded timeout |
| `web/tests/unit/app/dashboard/provider-business-tax.test.tsx:322,351` | 10 ms sleep waiting for a rejected download's catch handler | `waitFor(() => expect(errorSpy).toHaveBeenCalled())` |

## Reported, not changed

| Where | Finding | Recommendation |
|---|---|---|
| `web/playwright.config.ts:16` | `retries: process.env['CI'] ? 2 : 0` — CI retries each E2E test twice, so a flake passes silently | Keep until there is evidence (policy: no removal without it). First set `failOnFlakyTests: true` (Playwright 1.59 supports it) or read the report's flaky count for a few weeks; fix what shows up, then drop to 0 |
| `web/tests/e2e/bid.spec.ts:41,120`, `web/tests/e2e/job.spec.ts:46` | `test.skip(true, …)` at runtime when the form is not rendered — in backendless CI these pass vacuously | Skip up front on `!HAS_STACK` (as `marketplace.spec.ts` does), otherwise assert the form renders |
| `web/tests/e2e/provider-business.spec.ts:59,152` | Skip when `E2E_DEV_PROVIDER_TOKEN` is unset; CI never sets it, so these never run in CI | Wire a token in the live-stack job or move them to the dogfood suite |
| `web/tests/e2e/catalog/catalog.spec.ts:328` | `waitForTimeout(350)` before reading the action log (live-stack section, not run in CI) | `page.waitForFunction` on `__NOMARKUP_ACTION_LOG__` containing a `screen` hop, bounded |
| `web/tests/e2e/dogfood/*.ts` (18), `web/tests/e2e/audit/*.spec.ts` (27) | `waitForTimeout` sleeps; `dogfood/fixtures.ts:69-75` and `audit/full-wire-audit.spec.ts:270` are retry loops with backoff. Live-stack only (`testIgnore` without `SEED_PASSWORD`) | Replace with web-first assertions (`expect(locator).toBeVisible()`, `waitForResponse`); remove the retry loops — they are the policy's "retry wrapper" |
| Go DB tests that `t.Skipf` on *unreachable* after the URL is set: `gateway/internal/handler/{workspace_evidence,user_reports,activity,rum}_test.go`, `services/payment/internal/repository/{money_invariants,payment_cas}_integration_test.go` | With `DATABASE_URL` set, a dead database is an error, but the test reports skipped | Skip only when the variable is unset; `t.Fatalf` when it is set and the connection fails |
| Go tests that skip on a missing table ("apply migration 123/125/132", `job_liquidity_test.go:110`) or missing seed rows (`notification_emit_test.go:150`, `listing_report_hide_test.go:29`, `job_reports_test.go:137`, `services/user/…/encryption_db_test.go:102`, `services/job/…/category_metrics_test.go:217`, `services/payment/…/idempotency_test.go:108`) | Harmless in CI (migrated + seeded), but locally they hide; seed-dependent ones also share rows across packages (RC-21) | Fail on a missing migration; create the rows the test needs |
| `gateway/internal/vault/vault_test.go:136,189`, `services/payment/internal/repository/installment_status_test.go:181`, `engines/pricing/tests/health_shutdown_test.rs:108`, `services/job/internal/service/listing_rebuild_test.go` (`require.Eventually`) | Bounded polls for a condition with a deadline | Acceptable (wait-for-condition). The vault ones could use a channel from the fake server |
| `engines/pricing/tests/health_shutdown_test.rs:95` | 2 s sleep inside the server's shutdown future | Acceptable: it *is* the grace period under test |
| `engines/imaging/src/engine.rs:1996` (`cpu_render_runs_off_the_async_runtime`) | 20 ms sleep to let a heartbeat task start ticking | Replace with a barrier/oneshot the heartbeat signals on its first tick |
| `services/job/internal/service/bid_race_test.go:262` | Pacing sleep between iterations of a live-stack race test (rate limits) | Acceptable, deliberate and documented |
| `web/tests/unit/components/forms/LoginForm.test.tsx:292,301,311`, `web/tests/unit/lib/offline-drafts.test.ts:461` | 0–10 ms sleeps before *negative* assertions ("was not called") | `:311` → wait for the mocked fetch to settle; the others flush with `await act(async () => {})` |
| `web/tests/unit/components/command/command-palette.branches.test.tsx:198` | 300 ms real wait to prove the debounce did not fire | `vi.useFakeTimers()` and advance past the debounce |
| `web/tests/unit/lib/api.test.ts:422,454` | 10 ms delay inside a mock to make concurrent refreshes overlap | Acceptable: it constructs the race being tested |
| `ios/NoMarkupUITests/*` `XCTSkip` / `XCTSkipIf` | Device-only capabilities and missing credentials | Acceptable (named preconditions); UI tests are not in CI |
