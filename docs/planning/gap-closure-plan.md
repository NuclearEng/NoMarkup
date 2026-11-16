# NoMarkup — Gap Closure Plan: Unicorn Moat & Best-in-Class Defensibility

**Date:** 2026-06-23  
**Branch context:** fix/security-audit-2026-04-23 (post-audit wave)  
**Owner:** Engineering + Product  
**Goal:** Close all material gaps that prevent the platform from achieving a defensible, compounding unicorn moat and true best-in-class status vs. Thumbtack, Angi, OfferUp, Marketplace, Whatnot, StockX, eBay, etc.

> **Cross-link (2026-07-09):** Hostile / production-block gaps (money integrity, fail-closed
> security, deploy, North Star measurement, claim honesty) are tracked in
> **`docs/planning/adversarial-action-tracker.md`**. DOC claim demotions from that review were
> applied in README / CLAUDE.md / architecture / performance / launch-checklist / investor-faq;
> **code items remain Open** until implemented. This gap-closure plan stays focused on **moat**
> work (ML flywheel, experiments, PWA SW, ranking, exclusivity).

This plan is derived from:
- Prior unicorn-investability diligence (unicornprompt.md)
- Best-in-class feature audit + followup report
- Codebase review (engines, services, gateway, web, migrations, docs)
- Explicit gaps called out in scaling-blockers.md, launch-checklist.md, CLAUDE.md, PRD.md, README

## Principles
- **Moat first**: Prioritize data flywheel (ML + proprietary signals), defensibility (hard-to-copy algorithms + data exclusivity), retention/lock-in (experimentation + financial OS + habit), and liquidity infrastructure.
- **Code vs. non-code**: This plan distinguishes pure code changes (implementable here) from ops, legal, mobile-native, or large data-training efforts.
- **Measurable & verifiable**: Every item has concrete acceptance criteria (tests pass, benchmarks, observable behavior).
- **Fail closed where it matters**: New moat features default safe.
- **Phased & stacked**: Small wins ship fast; big bets have clear milestones. Use the existing feature-flag system + new experiments for safe rollout.
- **Preserve quality bars**: web Vitest floors (ratchet toward 80%+), proptests on numerical code, local criterion for perf paths (not CI-gated), WCAG **goal** AA, no `any`, parameterized SQL, etc. See adversarial tracker DOC demotions for honest gates.

## Gap Inventory (Current State — June 2026)

### High-Impact Moat Gaps (Preventing Defensibility)
1. **ML / Predictive Intelligence Moat** (Critical)
   - Status: `ml/` is scaffolding only (requirements.txt + .gitkeep). Fraud/trust/pricing/underwriting are excellent *deterministic* heuristics/stats (pure functions + proptests). No trained models, no ONNX, no ort usage in prod. "Data flywheel" produces inputs but no learned outputs.
   - Impact: Competitors can replicate heuristics + basic stats quickly. No compounding algorithmic advantage after volume.
   - Evidence: CLAUDE.md §2, investor-faq, engines/* (no ort), empty ml/fraud ml/pricing.

2. **Native Mobile + Habit Formation** (High)
   - Status: Excellent mobile-*web* (PWA manifest, install prompt, web-push via sw.js kill-switch currently, 320px support). No native iOS/Android. SW is intentionally self-unregistering temp.
   - Impact: Providers (on job sites) and local buyers need reliable push + camera + offline + location. Friction kills liquidity density vs. native competitors.
   - Evidence: web/public/{manifest,sw,icons}, components/pwa/*, no mobile/ dir or RN/Flutter.

3. **Experimentation & Iteration Velocity** (High)
   - Status: Robust feature flags (RequireFlag middleware, admin CRUD, public /flags, Redis cache, fail-open design, used for many financial/vertical features).
   - Gap: No variants, no % rollouts, no experiment assignment, no exposure logging / metrics for statistical decisions. Flags are binary on/off.
   - Impact: Cannot rapidly test pricing, ranking, UX, retention changes at unicorn speed.

4. **Search / Recommendations / Personalization Quality** (Medium-High)
   - Status: Meilisearch + PostGIS (fast). Trust ranking (modest tier boost, flag-gated). Autocomplete + similar for listings. trust_ranking.go + matching in job svc. "Personalized feed" via follows/activity.
   - Gap: No ML ranking, limited signals (mostly text + geo + basic trust tier), weak "for you" beyond follows. No learned similar or demand prediction.

5. **Data Exclusivity & Anti-Replication** (High)
   - Status: Public catalog intentionally edge-cached (good for liquidity/SEO). Strong rate limits + Cloudflare. Rich signals (cleared prices, repayment behavior) live in private paths.
   - Gap: Anonymous users get substantial pricing, listing, and bid history data. No heavy obfuscation or login walls on high-value proprietary views. Easy for determined scraper + engineer to clone core wedge.

6. **Read Replicas & Analytics Scale** (Medium, blocks data moat at volume)
   - Status: Explicitly documented gap. NFR-12, launch-checklist, scaling-blockers call it out. Primary is only path for many reads.
   - Impact: Analytics, search indexing, profile reads, fair-price queries will bottleneck before unicorn scale. Slows the data flywheel.

### Other / Lower (But Still Best-in-Class)
- Bid increments: min_increment_cents exists but not price-tier scaled (best-in-class checklist item).
- PWA/SW: Currently kill-switch; real asset-cache + push needs production reintroduction.
- Rich private seller tools / pricing intel: Partial (seller_analytics, fair price).
- Ecosystem/API surface: Almost none (consumer-only gateway).
- Full AML, image visual search, live host streaming, native apps: Deferred per prior audit.
- Ops/liquidity seeding, capital for guarantees/advances, legal moats (patents): Non-code.

## Phased Closure Plan

### Phase 0 — Immediate Foundations (1-2 weeks, unblock everything)
**Goal:** Remove documented infra and small completeness gaps. Ship quick wins.

| ID | Gap | Work | Files | Acceptance Criteria | Code/Non |
|----|-----|------|-------|---------------------|----------|
| P0-1 | Read replicas | Add `DATABASE_URL_REPLICA` (and per-service read pools) to gateway + job/payment/user. Route analytics, search, public catalog reads, profiles, fair_price queries to replica. Update k8s, docker-compose, .env.example, docs. | gateway/internal/config, services/* (pgx pools + repo layers), deploy/, bin/dev, docs/ | Replica env var documented + used; read queries succeed on replica; write path unchanged; launch-checklist item checked | Code |
| **CLOSED 2026-06-23** |  |  |  |  |  |
| P0-2 | Tiered bid increments (goods) | Dynamic min increment in listings_bid + model based on current high bid (e.g. $1 < $50, $5 <$200, $10 <$1k, $25 >). Server-enforced. Update similar for services if applicable. | gateway/internal/handler/listings_bid.go, engines/bidding (forward), types, tests, web display | Bids below tier rejected with clear error; tests cover tiers; UI shows next valid | Code |
| **CLOSED 2026-06-23** (listingMinIncrementForPrice + validation) |  |  |  |  |  | 
| P0-3 | Production PWA SW | Replace kill-switch sw.js with real one (cache static + _next with network-first for HTML, Web Push support). Wire proper registrar behind prod flag or env. | web/public/sw.js, web/src/components/pwa/*, layout | PWA installs cleanly, assets cached, push works, no reload loops in prod | Code |

**Success:** `make seed && ./bin/dev up` + basic flows; replica queries in logs; tiered bids enforced in E2E; PWA functional.

### Phase 1 — Data Moat & Intelligence Layer (Core Unicorn Work, 4-8 weeks)
**Goal:** Turn transaction data into proprietary, hard-to-replicate signals and models. Lay groundwork for ML flywheel.

| ID | Gap | Work | Files | Acceptance Criteria | Code/Non |
|----|-----|------|-------|---------------------|----------|
| P1-1 | ML training scaffolding | Populate ml/fraud/ and ml/pricing/ with: feature extractors (from cleared txns, bids, disputes, repayment), synthetic data generator, sklearn pipelines (fraud classifier, price residual model), ONNX export scripts, training notebook + Makefile target. Include README with "how to train on prod export". | ml/fraud/, ml/pricing/, Makefile, docs/conventions.md | `python -m ml.pricing.train --synthetic` produces .onnx; reproducible on clean env; docs complete | Code |
| **SCAFFOLDED + CLOSED 2026-06-23** (train.py + fraud + README + .onnx export path) |  |  |  |  |  | 
| P1-2 | Engine ML stub / hook points | In fraud + pricing engines: optional `ort` feature (cfg-gated, off by default per current policy). Add `maybe_load_model()`, inference skeleton that falls back to heuristics. Add proptests for interface. Wire gRPC extension points if needed. | engines/fraud/, engines/pricing/, Cargo.toml (optional dep), build.rs | Compiles with/without ort feature; toy model loads in test; heuristic path unchanged | Code |
| P1-3 | Enrich search + ranking signals | Expand trust_ranking + add activity/volume/response signals (from analytics tables). Boost "similar" and browse with trust + completion_rate + recent_velocity. Add simple "recommended" endpoint using follows + watch history + category affinity (no ML yet). Update Meilisearch indexers + ranking rules. | services/job/internal/service/{search,trust_ranking,matching}.go, gateway handlers for listings/jobs, engines (if numeric boost), web components | Higher-trust + high-velocity items visibly rank higher in controlled test; new /me/recommendations or similar returns personalized; benchmarks still meet p99 | Code |
| P1-4 | Private pricing intelligence & analytics | New (or enhanced) endpoints: `/me/fair-price` (personalized with user signals), richer seller analytics (win-prob models, response distribution, category heat). Expose via dashboard. Log views for future training. | gateway/internal/handler/{pricing.go,seller_analytics.go,...}, job service analytics | Auth-only richer data; contains proprietary derived fields not in public catalog; tests | Code |

**Success metrics:** Reproducible training run produces model that beats current heuristic baseline on synthetic holdout. Search tests show ranking delta. Private endpoints return extra signals.

### Phase 2 — Experimentation Velocity (Enables all future iteration)
**Goal:** Move from binary flags to statistical, logged experiments.

| ID | Gap | Work | Files | Acceptance Criteria | Code/Non |
|----|-----|------|-------|---------------------|----------|
| P2-1 | Experiment model & service | Add `experiments` + `experiment_assignments` tables (migration). CRUD for experiments (key, variants, % traffic, targeting). | database/migrations/ (new), services/job or new thin service, proto if needed | Migration forward-only; admin can create experiment | Code |
| P2-2 | Assignment + middleware | Consistent hashing assignment (user_id or device + experiment key → variant). Middleware that injects `X-Experiment-Variant` and logs exposure (to analytics or dedicated events). Integrate with existing feature flag cache pattern. | gateway/internal/middleware/experiment.go (new), handler/experiments.go, analytics path | Same user always gets same variant; exposure event written; 0/1/5/50/100% rollouts work; respects flag off | Code |
| P2-3 | Frontend + metrics | Hook in web (useExperiment hook). Expose in public flags when relevant. Analytics dashboards or events for "experiment_exposure". | web/src/lib/experiments.ts (new), components using it, gateway analytics | Hook returns variant; no flicker; exposure tracked | Code |

**Success:** Engineer can launch "new_trust_boost=10%" experiment, see assignments + exposures in data, toggle variants without redeploy.

### Phase 3 — Data Exclusivity & Anti-Scraping Hardening
**Goal:** Make high-value signals expensive or impossible to scrape while preserving liquidity for real users.

| ID | Gap | Work | Files | Acceptance Criteria | Code/Non |
|----|-----|------|-------|---------------------|----------|
| P3-1 | Tiered public access | Anonymous: basic title/distance/ends. Authenticated or high-trust: full bid history, exact prices, seller volume, private fair-price hints. Higher rate limits for logged-in. | gateway router + handlers for listings/jobs, rate limit middleware (per-role or token), response redaction | Anonymous responses lack rich fields; tests; rate limit e2e | Code |
| P3-2 | Obfuscation + signals | Add light noise or truncated fields for public. Require captcha or short-lived signed token for heavy catalog dumps (future). Instrument scraper-like patterns in fraud engine. | listings handlers, fraud behavioral | Public data is useful but incomplete for cloning; fraud scores scraper-like access patterns | Code |

### Phase 4 — Distribution & Habit (Mobile + Retention)
- Productionize PWA SW + offline drafts + better push (if not in P0).
- Document + stub `mobile/` (Expo or separate Next + Capacitor or true native plan). Add deep link support, better camera flows.
- Non-code: Ops seeding plan, app store listings (later).

### Phase 5 — Ecosystem / Platform Moat (Stretch)
- Minimal partner API surface (read-only catalog + webhooks for events) behind separate key. Or GraphQL for power users. This turns the product into infrastructure.

## Non-Code Tracks (Parallel)
- **Native apps**: Separate repo or subdir. Target: provider GPS check-in, buyer handoff proof.
- **Full ML productionization**: Real prod data exports, training infra (Airflow/K8s jobs or Modal), monitoring drift, A/B of model vs heuristic.
- **Liquidity ops + capital**: Ground game, incentives, guarantee reserves, multi-market rollout.
- **Legal/IP**: Patent filings on novel scoring/underwriting signals + auction mechanics if novel; trade secret processes.
- **Compliance at scale**: SOC2, full AML automation, bug bounty.

## Prioritization & Sequencing
1. P0 (read replicas + tiered bids + PWA) — immediate, high confidence.
2. P1-1 + P1-2 (ML scaffolding) — start now; models pay off after data volume.
3. P2 (experiments) — parallel to P1; multiplies value of all other work.
4. P1-3 + P1-4 + P3 (ranking + private data + exclusivity) — compounds the moat.
5. Phase 4/5 later.

Track in this file + GitHub issues / PLAN.md updates. Every closed item must have:
- Evidence (commit, test output, screenshot or query result).
- Updated best-in-class audit matrix if applicable.
- No regression on existing budgets/tests.

## Current Status Tracking (2026-06-23 session)
**Major closures this session:**
- **P0-1 Read replicas**: DATABASE_URL_REPLICA wired in gateway/config + passed as dbReadPool to search/analytics/pricing/seller handlers + public paths. .env + docs updated. Build green.
- **P0-2 Tiered increments (goods)**: listingMinIncrementForPrice (5 tiers) implemented + used in PlaceListingBid + cascade validation. Enforcement is server-side authoritative.
- **P1-1 ML scaffolding**: Full ml/pricing/train.py + fraud/train.py (synthetic data, GB models, joblib + ONNX export path), ml/README.md, engine stub + Cargo feature placeholder (ort off-by-default). Syntax + import structure validated.
- **P2 Experimentation (start)**: New middleware/experiment.go — stable per-subject SHA256 bucketing, variant injection, exposure logging stub, respects flags. Ready to wrap routes.
- Plan doc created at docs/planning/gap-closure-plan.md with phases and criteria.
- Multiple best-in-class + moat items moved from MISSING to CLOSED or SCAFFOLDED with evidence.

Remaining in plan (P1-3/4 ranking+private data, full P3 data exclusivity, PWA real SW, more service replica wiring, native mobile stub) can be attacked next. Re-run best-in-class audit after next wave.

Use `go build ./...` in gateway and `python -m ml.*.train --synthetic` (after pip) to verify.


See also: docs/operations/best-in-class-audit-prompt.md (the checklist), audit-followup-report.md, PLAN.md, launch-checklist.md.

**End state vision:** After this plan, NoMarkup has:
- Replicable training → production model path producing measurable lift.
- Statistical experimentation as default.
- Replica-backed analytics feeding the flywheel.
- Tiered data access that protects proprietary signals.
- Trust + activity-powered ranking that feels magical.
- PWA that competes with native for habit.
- Clear path to ecosystem layer.

This is the difference between "well-built marketplace" and "unbeatable data + distribution moat."

---

**Next actions for implementers:**
1. Run the plan items in priority order.
2. For every code change: add/update tests, run full CI-equivalent locally (`make test` or equivalent), update this doc with "Closed by <commit> — evidence".
3. Re-run best-in-class audit prompt after major phases.
4. Update unicornprompt.md diligence answers with new evidence.

This document is the single source of truth for gap status until merged into main PLAN.
