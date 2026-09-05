# Handoff — NoMarkup — 2026-06-10

## Goal
User ran `/qc` → verdict was DO-NOT-SHIP (4 blockers + ~15 warns). User then said:
"Close all gaps. Dont move forward until all are pass." Mid-wave-2 they interrupted
two subagents and said "commit. Save for later when we open this back up to keep
working." So: finish closing the remaining gaps, then re-run the full QC gate until
every area passes.

## State
11 commits on `fix/security-audit-2026-04-23` (31cb948..5f58d75) close all 4 blockers
+ most warns. Tree clean. ONE gap still open (bundle budgets, WIP in `stash@{0}`,
fails lint) + final full QC re-verification not yet run. Dev stack is DOWN (`bin/dev down` was run).

## Decisions & constraints (hard-won)
- Docker is NOT installed. Use `bin/dev up` (native stack; Postgres :5433 user
  `nomarkup`, gateway :8081 NOT 8080, web :3000). `docker compose` paths are legacy.
- Hooks block DROP DATABASE / TRUNCATE / printing seed creds. Targeted `DELETE FROM`
  via psql passes; `CREATE DATABASE` passes.
- Seeding: set your own SEED_PASSWORD env (seed upserts user passwords on conflict,
  so re-seeding rotates them — no need for the old one). Accounts:
  admin/customer/provider/provider2 @nomarkup.com. Seed is now idempotent (re-runs
  exit 0). `SEED_DEMO_MARKETPLACE=1` adds marketplace data.
- SW reload-loop root cause: kill-switch `web/public/sw.js` + prod registration in
  `ServiceWorkerRegistrar.tsx`. Fixed (registrar never registers; sw.js only reloads
  clients when it replaced a predecessor). NOT yet verified in a live prod build —
  that's part of the re-verify.
- Never run `next build` while `next dev` is up — a contaminated `.next` (dev chunks
  in prod HTML, dead hydration) burned us once. Kill port 3000 first (`lsof -ti :3000
  | xargs kill` — bin/dev's web.pid is unreliable).
- Do NOT re-flag documented accepted exceptions: /jobs/[id] 375kB, /jobs/new 309kB
  (docs/performance.md:35-41); HTML `private,no-store` is BY DESIGN (CSP nonce);
  style-src 'unsafe-inline' accepted; /metrics not ingress-routable (verified,
  deploy/k8s/README.md).
- golangci-lint not installed and not project-mandated (CI uses go vet) — treat vet
  as the lint gate.
- LCP lab numbers (2.86-3.16s) were measured against a broken-hydration build AND
  unsplash seed images that aren't in next.config remotePatterns (render unoptimized
  via ProgressiveImage fallback) — re-measure before trusting; CLS/TBT from that run
  were invalid.
- tests/integration module + job bid_race + payment idempotency tests drive a LIVE
  gateway at :8081 against the live dev DB — run with `-short` or a dedicated stack;
  never point them at the seeded dev DB.

## User corrections this session
- User REJECTED two wave-2 agents mid-flight: bundle-trim (task 7) and CI-integration.
  Their partial file edits remained on disk; user then said commit + save. The CI
  work was verified-enough and committed (5f58d75); the bundle work fails lint and
  was stashed instead. Don't re-launch big agent fan-outs without checking the user
  is ready for them.

## Verified vs assumed
- VERIFIED: govulncheck clean (gateway+payment) under go1.26.4; clippy -D warnings +
  549 Rust tests green; integration suites green locally (gateway 417, user 102, job
  175 -short, payment 543 -short) vs DB `nomarkup_itest`; fresh migration chain
  1→73 up/down/up clean; kustomize renders base+prod+staging with zero :latest;
  criterion: all 4 p99 budgets pass with 9-20,000× headroom (compute layer only);
  seed idempotent; gateway prod fail-fast exits 1 (empirical); web tsc+eslint clean
  on committed tree; 4109 web unit tests green (pre-wave-2 code).
- ASSUMED: SW fix actually stops the reload loop in a live prod build; axe serious
  violations now zero; LCP <2.5s after priority/sizes fixes; new CI job passes on
  GitHub Actions (authored + YAML-valid + commands replicate locally, never executed
  on GH — watch its first run).

## Uncommitted work
Tree clean. `stash@{0}` = task-7 WIP: terminal-grid code-split (terminal-grid-impl.tsx
+ terminal-grid-props.ts + test) + dynamic imports in provider/onboarding/page.tsx +
ListingPostingForm.tsx. FAILS LINT: 12 × @typescript-eslint/await-thenable in
terminal-grid-impl.tsx and terminal-grid.test.tsx. Unmeasured (no build run).

## Next steps
1. Task 7 (only open gap): `git stash pop`, fix the 12 await-thenable lint errors,
   then `cd web && npm run build` and check the 4 routes vs ≤300kB: /sell/new (was
   321), /auctions/[id]/replay (313), /auctions/[id]/spectate (309),
   /provider/onboarding (305). Trim further or write acceptance in
   docs/performance.md (mirror lines 35-41 style). Ensure no other route regressed,
   shared stays ≤190kB. Commit.
2. Task 12: full QC re-verify. `bin/dev up`, re-seed with fresh SEED_PASSWORD, kill
   :3000, clean `npm run build`, `npm start`. Confirm: no reload loop (watch document
   navigations via Playwright; old repro scripts may survive in /tmp/qc-crawl/),
   UI golden paths incl. payment (Stripe test keys ARE in .env.local), authed axe
   scans, 320px, Lighthouse LCP/CLS on /, /marketplace, /marketplace/[id], /jobs,
   caching headers (authed must now show private,no-store — new middleware), full
   build/security/ops gate re-run. Emit final SHIP table.
3. Watch first GitHub Actions run of the new `go-integration-test` job (5f58d75).
4. Task list (harness): #7 in_progress, #12 pending — update as you go.

## Resume
Run `/tokensaver-beautifulMind resume` in a fresh session.
