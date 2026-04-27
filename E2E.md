# NoMarkup — End-to-End Functional Test Prompt

Drop this into a fresh Claude session to drive a full E2E behavioral test
against the live local stack. It exercises every user persona's real
business flow against the Go gateway + Go services + Rust engines + Postgres,
and verifies state after every mutation.

---

## Prerequisites

Bring up the full stack first:

```bash
cd /Users/nuclearisotope/Projects/NoMarkup
bin/dev up infra      # postgres :5433, redis :6379, meili :7700, minio :9000
bin/dev up services   # user, job, payment, chat, notification
bin/dev up engines    # bidding, fraud, trust, imaging
bin/dev up gateway    # gateway :8081
make seed             # 4 users, 3 jobs, 4 bids, 2 contracts, etc.
cd web && npm run dev # web :3000
```

The seed step prints a one-shot password — capture it, e.g.:

```bash
make seed 2>&1 | tee /tmp/nomarkup-seed.log
grep "dev-account password" /tmp/nomarkup-seed.log
```

Or set `SEED_PASSWORD` before running `make seed` to use a fixed password.

---

## Prompt

```
Run a comprehensive end-to-end functional test of NoMarkup against the live
local stack at /Users/nuclearisotope/Projects/NoMarkup. The stack is already
up (infra + Go services + Rust engines + gateway :8081 + web :3000). DB is
seeded.

Seed accounts (password: read /tmp/nomarkup-tour/seed-pw.txt or
$SEED_PASSWORD if set):
- admin@nomarkup.com     (admin)
- customer@nomarkup.com  (customer)
- provider@nomarkup.com  (provider)
- provider2@nomarkup.com (provider)

Use Playwright via /Users/nuclearisotope/Projects/NoMarkup/web/node_modules
(model on /tmp/nomarkup-tour/tour.mjs but DO NOT use any mock layer — every
request must hit the real gateway). For each persona, drive the actual
business flow and verify state in Postgres after each mutation.

CUSTOMER FLOW (real auth login + every mutation):
1. /login as customer — verify cookie + JWT in store; AuthRestorer hydrates
2. /jobs/new — fill all 7 wizard steps, publish a NEW job, capture jobId
3. /jobs/{jobId} — verify it appears with bid_count=0
4. Switch to provider — /provider — confirm trust score loads from Rust trust
   engine (gRPC call to :50057)
5. Provider /jobs/{jobId} — place a bid; verify Bidding Engine accepts and
   bid_count increments live (WebSocket frame at /api/v1/auctions/{id}/stream);
   place 2 more bids from provider2 to test snipe extension
6. Customer /bids — accept the lowest bid; verify contract gets created
   (postgres contracts table row count +1) and Stripe PaymentIntent fires
   with idempotency key (check stripe_events table)
7. Provider /provider/workspace — see the awarded contract; mark check-in via
   /contracts/{id}/work-session, then check-out
8. Customer /contracts/{id} — accept completion; verify auto-release timer
   starts (auto_release_at column populated)
9. Customer /contracts/{id}/review — submit 5★ review; verify trust engine
   recalculates provider score (check trust_scores table updated_at)
10. Provider /provider/business/tax — verify YTD totals reflect the new
    contract
11. Customer /payments — confirm payment escrow → released state machine

PROVIDER FLOW:
1. /provider/onboarding — complete every step; verify upload to MinIO via
   imaging engine (check minio bucket nomarkup-dev)
2. /provider/team — create employee, run background check (mock), verify
   status change in employees table
3. /provider/business/expenses — add 2 expenses,
   /provider/business/invoices — verify auto-generation from contract
4. /provider/advances — request a working capital advance; verify approval
   from Go payment service + credit-limit recalc
5. /provider/challenges — enroll in challenge; verify state in
   challenge_participants table

ADMIN FLOW:
1. /login as admin
2. /admin — verify all platform metrics are NON-ZERO and reflect the
   customer/provider activity from the previous flows
3. /admin/users — search "customer", verify result; suspend the test user;
   verify status change reaches AuthRestorer (next refresh redirects to
   suspended page)
4. /admin/fraud — verify any alerts surfaced by the Rust fraud engine. Try
   triggering one: post 5 jobs in 30s as customer to hit the velocity
   heuristic (fraud-engine should generate a velocity_high alert)
5. /admin/disputes — file a dispute as customer first, then resolve as
   admin; verify resolution_notes column populated
6. /admin/payments — verify escrow rows match what customer paid

ANON / PUBLIC:
1. / — verify ticker has live category prices from market_ranges table (not
   the seed-time snapshot)
2. /jobs — verify the customer's new job appears with real market range
3. /providers — verify provider search returns provider1 + provider2 with
   real trust scores
4. /pricing — verify FairPriceIndex shows real aggregates per category
5. /demo/auction — verify the live auction terminal connects to a real
   auction WebSocket

REPORT (don't be polite — be honest):
- For each step, mark PASS / PARTIAL / FAIL with the exact failure (HTTP
  status, console error, postgres row count delta)
- After mutations, query postgres directly to verify state
  (psql postgres://nomarkup:nomarkup@localhost:5433/nomarkup) and report
  row counts before/after
- Capture WebSocket frames during the bidding test to confirm real-time
  delivery — use page.on('websocket', ws => ws.on('framesent', ...))
- Diff the Rust trust engine logs to confirm it ran on the new review
  (check .dev/logs/trust.log for "score recomputed" entries)
- Diff the Rust fraud engine logs for the velocity test
  (check .dev/logs/fraud.log)
- At the end, list every unimplemented or broken feature found

Output: /tmp/nomarkup-e2e/report.md with screenshots per step at
/tmp/nomarkup-e2e/screenshots/{persona}/{step}.png.
Include a "Verification matrix" table listing each persona × feature with
the verdict and the SQL query used to confirm.
```

---

## What this catches that the visual tour didn't

| Layer | Visual tour | This E2E test |
|---|---|---|
| HTML renders | ✅ | ✅ |
| Mock data fits page shape | ✅ | n/a |
| Real auth (JWT round-trip) | ❌ | ✅ |
| Real DB writes | ❌ | ✅ |
| gRPC fanout (Go → Rust engines) | ❌ | ✅ |
| WebSocket frames (real-time bidding) | ❌ | ✅ |
| Stripe webhook signature validation | ❌ | ✅ |
| Idempotency keys | ❌ | ✅ |
| Trust score recomputation triggers | ❌ | ✅ |
| Fraud engine heuristics fire | ❌ | ✅ |
| MinIO uploads (imaging pipeline) | ❌ | ✅ |
| State machine transitions (escrow, contract, dispute) | ❌ | ✅ |

---

## Suggested invocation

```bash
cd /Users/nuclearisotope/Projects/NoMarkup
claude --dangerously-skip-permissions < E2E.md
```

(Or open Claude Code in this directory and paste the **Prompt** section.)

The test typically takes 15–25 min and produces a report at
`/tmp/nomarkup-e2e/report.md` plus per-step screenshots.
