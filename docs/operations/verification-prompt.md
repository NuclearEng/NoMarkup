# NoMarkup — 100% Verification Prompt

> Hand this to a fresh Claude session, an agent, or a senior engineer
> doing a pre-launch audit. The agent should produce a single PASS/FAIL
> report with concrete gaps. Anything FAIL blocks shipping to a VC demo.

---

## The Prompt

Copy everything between the `---` markers into a new session. The agent
will need read access to the repo, the local Postgres, Redis, and a
running web server. It should NOT mutate state outside of running tests
and capturing screenshots.

---

You are auditing whether NoMarkup is 100% implementation-complete and
ready for a live VC walkthrough. The repo lives at
`/Users/nuclearisotope/Projects/NoMarkup` on `fix/security-audit-2026-04-23`.

NoMarkup is a two-sided marketplace platform with two surfaces:
- **Services** (reverse-auction): `/jobs`, `/bids`, `/contracts`
- **Goods** (forward-auction): `/marketplace`, `/sell`, `/orders`

The wedge is **live auctions** — the homepage at `/marketplace` is a
sports scoreboard with live countdowns, watcher counts, and snipe
extensions, not a static listings grid. Verify both the wedge and the
surrounding infrastructure are real and working.

Produce a single Markdown report at `/tmp/nomarkup-verification.md`
following the structure at the bottom of this prompt. Mark every check
PASS, FAIL, or PARTIAL with concrete evidence (file paths, line numbers,
command output, error messages, screenshot paths). Do not mark anything
PASS based on the existence of code — verify behavior end-to-end.

### 0. Pre-flight

Verify the local environment is in a runnable state. If anything below
fails, do NOT proceed — the rest of the audit is meaningless without it.

- [ ] `cd /Users/nuclearisotope/Projects/NoMarkup && git status` shows a clean tree (or only expected modifications)
- [ ] `git rev-parse --abbrev-ref HEAD` returns `fix/security-audit-2026-04-23`
- [ ] Docker is running: `docker ps` succeeds
- [ ] `docker compose ps` shows postgres, redis, meilisearch, minio all healthy (or equivalent local services)
- [ ] `curl -sf http://localhost:5432` connects (Postgres up)
- [ ] `redis-cli -u $REDIS_URL ping` returns `PONG`
- [ ] `psql $DATABASE_URL -c "select 1"` succeeds
- [ ] All migrations applied: `psql $DATABASE_URL -c "select max(version) from schema_migrations"` matches the highest-numbered file in `database/migrations/`

### 1. Build & Test Gates

All of the following must pass with zero errors/warnings before anything
else matters.

- [ ] **TypeScript**: `cd web && bun run typecheck` (or `tsc --noEmit`) — 0 errors
- [ ] **ESLint**: `cd web && bun run lint` — 0 errors, 0 warnings
- [ ] **Vitest unit tests**: `cd web && bun run test` — all pass, ≥3,800 tests
- [ ] **Vitest coverage**: `cd web && bun run test -- --coverage` — ≥80% on lines / branches / functions / statements
- [ ] **Playwright E2E** (if seed data is loaded): `cd web && bun run test:e2e` — critical paths pass
- [ ] **Go services compile**: `for d in gateway services/*/; do (cd "$d" && go build ./...) || echo FAIL "$d"; done`
- [ ] **Go tests**: `for d in gateway services/*/; do (cd "$d" && go test ./...) || echo FAIL "$d"; done`
- [ ] **Rust engines compile**: `for d in engines/*/; do (cd "$d" && cargo build --release) || echo FAIL "$d"; done`
- [ ] **Rust tests**: `for d in engines/*/; do (cd "$d" && cargo test --release) || echo FAIL "$d"; done`
- [ ] **Database seed compiles + tests**: `cd database && go build ./cmd/seed/ && go test ./cmd/seed/`

For each FAIL, capture: failing command, exit code, last 30 lines of output, and the file path it points to.

### 2. Runtime Smoke

Boot the full stack locally. Capture the boot log for each service and
confirm no panics, no fatal errors, no `level=error` lines on startup.

```bash
docker compose up -d
cd database && SEED_DEMO_MARKETPLACE=1 SEED_PASSWORD=Password123! ./seed
cd web && bun run dev > /tmp/web.log 2>&1 &
# bring up gateway + services + engines per the docker-compose or service Makefiles
```

- [ ] Web responds: `curl -sf http://localhost:3000/` returns 200
- [ ] Gateway health: `curl -sf http://localhost:8080/api/v1/health` returns `{"status":"ok"}`
- [ ] Each Go service registers on its gRPC port (per CLAUDE.md §12)
- [ ] Each Rust engine registers on its gRPC port
- [ ] No panics in any service log: `grep -i "panic\|fatal\|level=error" /tmp/*.log` empty (or only known-benign)

### 3. The Wedge — Live-Auction Scoreboard

This is the part the VC walkthrough leads with. Failure here means the
demo doesn't work. Be ruthless.

Run with the demo seed loaded (40 listings: 8 closing <10min, 12 <1h,
20 <24h). Capture screenshots at desktop (1440×900) and mobile (320×568).

- [ ] `/marketplace` loads with HTTP 200
- [ ] Header reads "The **Live** Marketplace" with the gold "Live" word
- [ ] Subtitle: "Auctions are watched, not posted. Highest bidder wins on the clock."
- [ ] **UrgencyStrip** visible at top with three KPI tiles (CLOSING <1H, WATCHING, LIVE BIDS)
- [ ] CLOSING <1H count > 0 (demo seed has 20 listings closing <1h: 8 critical + 12 urgent)
- [ ] **Closing Now** section visible with red ribbon ("Ending now") and red border glow on at least 6 cards
- [ ] **Closing Soon** section visible with gold ribbon ("Closing soon") on at least 8 cards
- [ ] **Later Today** section visible with no ribbon
- [ ] Each card has: photo, title, current bid (formatted $X.XX), bid count, location, ticking countdown
- [ ] Countdown re-renders every second (open dev tools, watch for ~1Hz state updates)
- [ ] Snipe-extension badge ("+30s ×N") visible on at least 5 cards (demo seed has snipeExtensions > 0 on several)
- [ ] Mobile (320×568) renders without horizontal scroll, KPIs stack readably, Filters toggle accessible
- [ ] No console errors, no 4xx/5xx network requests except expected ones

Capture: `/tmp/nomarkup-scoreboard-desktop-populated.png` and `/tmp/nomarkup-scoreboard-mobile-populated.png`.

### 4. Critical User Paths

Each path must complete end-to-end without manual DB poking. Use seed
accounts: `customer@nomarkup.com` / `provider@nomarkup.com` /
`provider2@nomarkup.com`, all `Password123!`.

#### Goods — forward auction (the wedge)

- [ ] Buyer browses `/marketplace`, sees populated scoreboard
- [ ] Buyer clicks a closing-soon listing, lands on detail page
- [ ] Detail page shows photos, current bid, bid history, location, countdown
- [ ] Buyer (logged-in) places a bid above the current high bid
- [ ] Bid succeeds: `current_bid_cents` updates, bid count increments, page reflects new state
- [ ] **WebSocket bid stream** (if implemented): a second buyer in another browser sees the bid update without refresh
- [ ] Auction closes (advance the clock or wait): status → `sold`, winner is highest bidder
- [ ] `listing_orders` row created with `escrow_status='held'`
- [ ] Seller confirms pickup, buyer confirms pickup, escrow → `released`

#### Services — reverse auction

- [ ] Customer posts a job at `/post-job` with budget range
- [ ] Provider sees the job in `/jobs/match` and submits a bid below the budget cap
- [ ] Customer sees the bid at `/jobs/{id}` and accepts it
- [ ] Job → `awarded`, contract created, escrow held
- [ ] Provider marks complete, customer confirms, escrow released

#### Trust transfer

- [ ] A user who completes a goods sale sees their trust score bump
- [ ] That same trust score is visible on the same user's services profile
- [ ] Service-side trust score affects services bid eligibility

### 5. Security & Compliance

These are non-negotiable per CLAUDE.md §6. Any FAIL is a launch blocker.

- [ ] **CSP nonce**: `curl -I http://localhost:3000/` shows `Content-Security-Policy` with per-request `nonce-XXX` and `'strict-dynamic'`
- [ ] No `unsafe-inline`, no `unsafe-eval` in CSP
- [ ] **HSTS**: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (or staging-equivalent)
- [ ] **Auth wrapper coverage**: every API route handler has either `withAuth()` or a documented `// @public` annotation. Run a grep audit: `grep -rL "withAuth\|@public" gateway/internal/handler/*.go` should be empty
- [ ] **JWT**: tokens signed RS256, ≤15-min access TTL, refresh in HTTP-only secure cookies
- [ ] **Argon2id**: `grep -rE "argon2id\\b" services/user/internal/service/auth*.go` finds the password hashing
- [ ] **PII encryption**: `users.email_encrypted` (or equivalent) populated; verify with a SELECT on a known seed user
- [ ] **GDPR erasure**: `psql $DATABASE_URL -c "select count(*) from gdpr_delete_requests where status='pending'"` works; pipeline test passes
- [ ] **Stripe webhook signature verification**: `grep -rE "ConstructEvent\|VerifySignature" services/payment/` returns matches
- [ ] **Idempotency keys**: every payment mutation route uses `RequireIdempotencyKey` middleware
- [ ] **Rate limits**: hit `/api/v1/auth/login` 6 times in 15 min → 429 on the 6th
- [ ] **No secrets in code**: `git log --all --oneline | head -50; trufflehog filesystem .` (or equivalent) returns no findings
- [ ] **CORS**: production origin allowlist explicit; no wildcards

### 6. Performance Budgets

Per CLAUDE.md §8. Run a load test and capture metrics.

- [ ] **k6 load test on /marketplace**: `k6 run tests/load/marketplace-scoreboard.js` with 100 vu — p95 < 200ms, p99 < 500ms, 0 errors
- [ ] **Bid processing p99 < 1ms**: run `cd engines/bidding && cargo bench` and capture criterion output
- [ ] **Trust score p99 < 5ms**: `cd engines/trust && cargo bench`
- [ ] **Search p99 < 50ms**: hit Meilisearch via `/api/v1/listings?q=eames` 100 times, measure with `hyperfine`
- [ ] **Bundle size**: `cd web && bun run build` — initial JS < 200KB gzipped, per-route < 50KB gzipped
- [ ] **Lighthouse**: run against `/marketplace`, score ≥90 Performance, ≥95 Accessibility, ≥95 Best Practices

### 7. Demo Readiness

The pitch artifacts must exist, be accurate, and reflect what's shipped.

- [ ] `docs/one-pager.md` exists, mentions the wedge, gives the ask
- [ ] `docs/pitch.md` exists, ≥9 sections, claims match repo state (no fabricated traction)
- [ ] `docs/demo-script.md` exists with minute-by-minute steps and a T-30 checklist
- [ ] `docs/investor-faq.md` exists, covers market, product, trust, stack, biz model, risks
- [ ] All demo-script.md commands actually work in the local environment
- [ ] T-30 pre-demo checklist runs to PASS
- [ ] Populated scoreboard screenshot is recent and matches what the demo will show

### 8. Documentation Drift

Docs must reflect shipped reality. The PRD/CLAUDE.md/marketplace.md
should not claim features that aren't built.

- [ ] `docs/marketplace.md` accurately describes current schema (migration numbers match)
- [ ] CLAUDE.md service-port table matches actual `gateway/cmd/server/main.go` env vars
- [ ] `docs/route-map.md` (if present) matches actual mounted routes
- [ ] No `TODO` / `FIXME` / `XXX` comments in production code paths that block the demo

### 9. Known Gaps (catalog, don't necessarily block)

Some features are roadmap. List them so VCs know what's v2:

- [ ] WebSocket marketplace bid streaming (`/ws/marketplace/{listingId}`) — present or roadmap?
- [ ] Redis spectator-count aggregator for the watcher badge — present or roadmap?
- [ ] Push notifications (closing-60s, closing-10s, outbid) — present or roadmap?
- [ ] iOS / Android native apps — explicitly v2 per pitch.md
- [ ] ML fraud inference (ONNX) — explicitly v2 per CLAUDE.md
- [ ] Shipping (vs local pickup) — explicitly v2 per pitch.md

For each, mark: SHIPPED, PARTIAL, ROADMAP, with one-line evidence.

---

## Output Format

Write the final report to `/tmp/nomarkup-verification.md` with this exact structure:

```markdown
# NoMarkup Verification Report — {ISO date}

**Branch:** fix/security-audit-2026-04-23
**Commit:** {short SHA}
**Verdict:** READY / NOT READY / READY WITH GAPS

## Summary

{2-3 sentence assessment. If NOT READY, name the top 3 blockers.}

## Section Results

| Section | Result | Notes |
|---------|--------|-------|
| 0. Pre-flight       | PASS/FAIL | ... |
| 1. Build & test     | PASS/FAIL | ... |
| 2. Runtime smoke    | PASS/FAIL | ... |
| 3. Wedge scoreboard | PASS/FAIL | ... |
| 4. User paths       | PASS/FAIL | ... |
| 5. Security         | PASS/FAIL | ... |
| 6. Performance      | PASS/FAIL | ... |
| 7. Demo readiness   | PASS/FAIL | ... |
| 8. Doc drift        | PASS/FAIL | ... |

## Gaps That Block VC Demo

1. ...
2. ...

## Gaps That Don't Block (v2 roadmap)

- ...

## Screenshots

- /tmp/nomarkup-scoreboard-desktop-populated.png
- /tmp/nomarkup-scoreboard-mobile-populated.png

## Performance Numbers

- p99 bid processing: {ms}
- p99 trust scoring: {ms}
- Lighthouse Performance: {score}
- Bundle size (initial JS gzipped): {KB}
- /marketplace p95 under 100vu: {ms}

## Failed Commands (full output)

{command + error block, one per failure}
```

Be ruthless. Mark PARTIAL only when something works for the happy path
but skips edge cases. Mark FAIL when the feature is missing or broken.
A "100/100 implementation" claim must survive this audit.

---

## How to use this prompt

**Option A — fresh Claude session:**
```
/clear
Read docs/operations/verification-prompt.md and execute the audit.
Produce /tmp/nomarkup-verification.md.
```

**Option B — agent:**
```
Agent({
  subagent_type: "general-purpose",
  description: "100% verification audit",
  prompt: "Read /Users/nuclearisotope/Projects/NoMarkup/docs/operations/verification-prompt.md and execute the audit. Boot the local stack, run all sections, capture screenshots, and write /tmp/nomarkup-verification.md. Be ruthless — mark PARTIAL when something works for the happy path but skips edges, FAIL when missing or broken."
})
```

**Option C — multi-agent parallel** (faster, less complete coverage per agent):
spawn 4 agents — one for sections 0-2, one for 3-4, one for 5-6, one for 7-9.
Each writes a partial report. Stitch them together.
