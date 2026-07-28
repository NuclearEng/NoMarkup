# NoMarkup Launch Readiness Checklist

From code-complete to real users on production. Every item must be checked off or explicitly deferred with a reason before launch.

> **Truth pass (2026-07-09):** Owned production domain is **`no-markup.com` only** (hyphenated —
> `nomarkup.com` is **not** owned). Migrations run through **`073_*`**. Deploy remains
> **fail-closed** until `DEPLOY_PROVISIONED=true` and secrets/cluster are real — see
> `docs/operations/provisioning-checklist.md`. Unchecked items below are work remaining, not
> capabilities already in production. Adversarial gaps: `docs/planning/adversarial-action-tracker.md`.

**Launch market:** King County / Seattle metro, WA (seeded markets; expand via admin Markets tool)
**Capacity target (aspirational):** scale design toward high concurrent load — **unproven** until k6/staging load reports exist
**Uptime SLA target:** 99.9% (design goal — not measured in prod; prod not provisioned)

---

## 0. Production gate (do first)

- [ ] Set repo/environment `DEPLOY_PROVISIONED=true` **only after** cluster + secrets + migrate-on-deploy work
- [ ] Confirm `deploy.yml` no longer exits placeholder-only (currently fail-closed until provisioned)
- [ ] Secrets in Vault/ESO/K8s — staging + production overlays have no `REPLACE_ME_*`/`SET_ME_*` (OPS-08 Partial: image tags are `require-ci-stamp` until CI; provision real `GOOGLE_CLIENT_ID` into `nomarkup-secrets` per env)
- [ ] DNS + TLS for **`no-markup.com`** / **`www.no-markup.com`** only
- [ ] Run migrations **001 → 073** on production Postgres (PostGIS 3.4)
- [ ] Smoke: `curl -f https://no-markup.com` and `https://no-markup.com/api/health` (or actual gateway path)

---

## 1. Infrastructure Provisioning

### Kubernetes Cluster
- [ ] Provision managed Kubernetes cluster (EKS or GKE — open product decision)
- [ ] Minimum 3 nodes (production overlay targets gateway multi-replica; verify live HPA)
- [ ] Configure `nomarkup` namespace (per `deploy/k8s/base/namespace.yaml`)
- [ ] Install ingress controller matching `ingressClassName` in manifests
- [ ] Apply network policies — **fix selectors first** (known gap: label mismatch vs pods; OPS-05/06)
- [ ] Verify HPA objects that exist (gateway + bidding today); expand as needed
- [ ] Configure PVCs for stateful services as required by manifests
- [ ] **Note:** `deploy/terraform/` is a **Partial skeleton** (OPS-02) — README inventory + draft modules; founder applies against a real AWS account (or documents external provisioner) before `DEPLOY_PROVISIONED`

### DNS & TLS (owned zone only)
- [ ] Verify registrar/DNS for **`no-markup.com`** (Cloudflare account holds zone)
- [ ] Point `no-markup.com` and `www.no-markup.com` to ingress / load balancer
- [ ] Provision TLS certificate (edge TLS 1.3) and create K8s TLS secret referenced by ingress
- [ ] Verify SSL redirect on ingress
- [ ] Configure Cloudflare CDN/cache rules for **public DATA / static assets** (not app HTML — CSP nonce)
- [ ] Optional API host if used: document actual hostname (do **not** invent `nomarkup.com`)

### Managed Data Stores
- [ ] Managed PostgreSQL 16 + PostGIS 3.4
- [ ] PgBouncer (or managed pooling) sized for prod
- [ ] Managed Redis 7
- [ ] Meilisearch 1.x with durable storage
- [ ] S3 bucket(s): public assets + private docs (no public read on private)
- [ ] Confirm production `S3_*` does not point at MinIO

### Container Registry
- [ ] Registry auth (GHCR default in CI; `GITHUB_TOKEN` + `packages:write` on main `build` job)
- [x] CI pushes images on main (OPS-21) — `docker/login-action` → GHCR + real `docker push` as `ghcr.io/<owner>/nomarkup/<svc>:<sha8>`; optional `vars.DOCKER_REGISTRY` / `secrets.REGISTRY_*` override
- [ ] Build images for: web, gateway, user, job, payment, chat, notification, bidding, fraud, trust, imaging
  (underwriting/pricing as deployed in your compose/k8s layout)

---

## 2. Secrets & Configuration

### Cryptographic Keys
- [ ] Production JWT RS256 keypair (store in Vault/K8s secret — not disk in prod)
- [ ] Production `SESSION_SECRET`
- [ ] `ENCRYPTION_KEY` / PII secretbox key material (rotation plan: `docs/operations/encryption-key-rotation.md`)
- [ ] `INTERNAL_WS_SECRET` on **gateway + chat** (production must not start empty — SEC-03)

### Stripe (Live Mode)
- [ ] Activate Stripe live mode; live secret + publishable keys
- [ ] Connect Express platform settings
- [ ] Webhook endpoint on production origin, e.g. `https://no-markup.com/api/webhooks/stripe` (confirm path)
- [ ] `STRIPE_WEBHOOK_SECRET`; subscribe required events
- [ ] Sign Connect platform agreement

### Email (SendGrid)
- [ ] Production SendGrid; SPF/DKIM/DMARC for **`no-markup.com`**
- [ ] `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (e.g. `noreply@no-markup.com`)
- [ ] Templates for verification, bid awarded, payment, dispute, etc.

### OAuth
- [ ] Google OAuth redirect base `https://no-markup.com` (and callback path as implemented)
- [ ] Apple Sign-In if shipping on web
- [ ] `FRONTEND_URL=https://no-markup.com`

### Maps / Monitoring
- [ ] Mapbox **public** `pk.` token URL-restricted to `no-markup.com`
- [ ] Sentry projects + DSNs; OTel exporter to a **real** backend (collector must not debug-only discard)

### Environment Validation
- [ ] `ENVIRONMENT=production`
- [ ] `NEXT_PUBLIC_API_URL` points at production origin (not localhost)
- [ ] Feature flags reviewed for launch (see §3)

---

## 3. Database

### Migrations
- [ ] Run **all migrations 001 through 073** on production in order
- [ ] Verify core tables from `001_initial_schema` + later marketplace/goods/financial migrations
- [ ] Taxonomy / categories seeds (002, 005, 006, 009, expansions 052–053)
- [ ] Feature flags: `013_feature_flags` + **`060_seed_financial_feature_flags`**
- [ ] Launch markets (e.g. WA / King County migrations 055, 058, 059)
- [ ] Confirm `trigger_set_updated_at()` and money-related indexes present

### Feature Flags (suggested production defaults — adjust deliberately)
| Key | Suggested launch | Notes |
|-----|------------------|-------|
| `live_auction` | on if shipping live WS arena | Also respect `NEXT_PUBLIC_ENABLE_LIVE_AUCTION` / env gates |
| `customer_bnpl` | on only if money paths audited | Seeded on in 060 — **confirm** |
| `instant_payout` | on only if live payout wired | Seeded on — verify not stub-success |
| `per_job_insurance` | optional | Seeded on |
| `working_capital` | optional | Seeded on; underwriting fail-closed when unwired |
| `lead_gen` | **off** | Seeded off |
| `insurance_competition` | **off** | Preview only |
| `legal_services` | **off** | Preview only |
| fair-price / spectator / guarantee flags | per product | Do not enable without data + ops |

**Flag enforcement truth:** gateway `RequireFlag` → 503 when row exists and `enabled=false`; missing row / DB error currently **fail open**. Target financial fail-closed: SEC-01.

### Data Seeding
- [ ] Launch-market categories and market pricing for Seattle metro ZIPs as needed
- [ ] fair_price_index data if Fair Price Index is on

### Backup & Recovery
- [ ] Daily backups + PITR; test restore
- [ ] Document RTO/RPO (`docs/operations/backup-disaster-recovery.md`)
- [x] Read replica path: `DATABASE_URL_REPLICA` + gateway read pool (code landed; **provision** replica in prod)

---

## 4. CI/CD Pipeline

### Current Pipeline (truth)
- [ ] `ci.yml` green on main: web lint + typecheck, Vitest (**floors** ~71–77% in `vitest.config.mts`, not blanket 80% all metrics), Playwright **Chromium** E2E (backend-tolerant; full dogfood needs stack + `SEED_PASSWORD`), Go tests + PostGIS service container integration, Rust fmt/clippy/test
- [ ] `security-scan.yml` green (govulncheck, cargo-audit, npm audit **policy**: prod deps + high+ only — see `docs/conventions.md` QA-15 residual)
- [ ] **QA-10 Founder-Action:** branch protection on `main` requires status check **`Security Gate`** (aggregate job in `security-scan.yml`). Scanners are a separate workflow — not in `ci.yml` `build.needs`. Without this setting, merge is not gated on dependency audits.
- [ ] **Not in CI today (or Partial only):** criterion p99 gates, k6 full load (smoke optional via `K6_BASE_URL` — PERF-10 Partial; artifact `k6-smoke-<run_id>`), CDN TTFB sample optional via `CDN_TTFB_BASE_URL` (PERF-13 Partial), Lighthouse lab floors optional (PERF-02 Partial; artifact `lighthouse-reports-<run_id>`), full axe AA on real routes, Go/Rust 80% coverage gates, Husky pre-commit

### Deploy Pipeline
- [ ] **CRITICAL:** real deploy (build/push → migrate → apply → smoke) behind `DEPLOY_PROVISIONED`
- [ ] Rollout status + rollback procedure documented
- [ ] Migration down is **manual** in prod (forward-only)

---

## 5. Monitoring & Alerting

- [ ] Deploy Prometheus/Grafana/Alertmanager **or** managed equivalent (manifests under `deploy/monitoring/` are not automatic prod)
- [ ] Scrape correct metrics ports (engines need `*_METRICS_PORT` where required)
- [ ] Dashboards: HTTP/gRPC latency, bid/trust/fraud budgets, WS, Stripe webhooks, DB pool, Redis, Meili
- [ ] Alerts: error rate, payment failures (**P0**), latency, disk, cert expiry
- [ ] OTel → real backend; Sentry web + Go + Rust
- [ ] External uptime on `https://no-markup.com` and health endpoint
- [ ] Status page hostname under **`no-markup.com`** if public

---

## 6. Security (verify against code + docs truth)

### Endpoint / edge
- [ ] CORS allowlist: production origins for **`no-markup.com`** / `www` only (no wildcards)
- [ ] CSP: **script** nonce + no `'unsafe-eval'` in prod; **`style-src` may include `'unsafe-inline'`** (SEC-11 Demoted accepted — permanent Next/Mapbox residual)
- [ ] Rate limits on auth; CSRF where applicable; admin/support role gates
- [ ] Idempotency on money mutations (see money tracker for remaining gaps)

### Auth
- [ ] JWT RS256, 15m access, HTTP-only refresh, idle timeouts (customer 60 / provider 120 / admin 30)
- [ ] argon2id params; MFA for admin

### Data protection
- [ ] PII: **XSalsa20-Poly1305 secretbox** on inventory fields; **email plaintext** — not “AES-256-GCM everything”
- [ ] Mesh: private network plaintext gRPC until mTLS; edge TLS only for public
- [ ] Private S3 for docs; MIME + size limits

### Vulnerability scans
- [ ] govulncheck / cargo audit / npm audit clean per policy
- [ ] Pen-test schedule

---

## 7. Application Verification (staging or prod-like)

### Core services reverse auction
- [ ] Register/login/OAuth/password reset/MFA
- [ ] Post job → bid → award → contract → complete → escrow release → double-blind **contract** reviews
- [ ] Live auction WS if flag/env enabled

### Goods marketplace
- [ ] List → bid (with lock/idempotency) → close/BIN → order/escrow → pickup confirm
- [ ] After escrow **released**: buyer and/or seller leave overall rating on `/orders/{id}` (MVP; not 8-dim double-blind)
- [ ] Listing detail seller card shows aggregate goods rating when the seller has published buyer reviews
- [ ] Do **not** expect goods 8-dim double-blind reviews (intentional product backlog; FE-14 MVP Done)

### Payments (live Stripe only with small amounts)
- [ ] Connect onboarding, hold/release, refunds, webhooks
- [ ] BNPL / instant payout / advances only if flags on **and** money paths verified against adversarial tracker

### Chat / notifications / search / imaging
- [ ] WS messaging + persistence; off-platform content filters as implemented
- [ ] In-app notifications; email when SendGrid configured
- [ ] Meilisearch jobs/listings; geo filters via PostGIS
- [ ] Imaging resize via Rust `image` crate pipeline

### Admin
- [ ] Users, jobs, fraud queue, disputes, verification, flags, markets, audit log

### Performance (measure, don’t assume)
- [ ] Record lab Lighthouse LCP/INP/CLS on `/`, marketplace, jobs — **expect multi-second LCP until improved**
- [ ] Confirm public JSON CDN headers on catalog endpoints
- [ ] Bid engine p99 bench **local** (criterion not CI)
- [ ] Optional k6 against staging — CI job `k6-smoke` when `K6_BASE_URL` set (artifact `k6-smoke-<run_id>`); full profiles still manual
- [ ] Optional CDN TTFB sample — CI job `cdn-ttfb-sample` when `CDN_TTFB_BASE_URL` (or `K6_BASE_URL`) set; artifact `cdn-ttfb-<run_id>`

---

## 8. Legal & Business

- [ ] Entity, licenses, bank, EIN
- [ ] ToS / Privacy at **`no-markup.com/terms`** and **`/privacy`**
- [ ] CCPA export/delete flows functional
- [ ] PCI SAQ path (Stripe Elements)
- [ ] Insurance (GL / E&O / cyber) as required
- [ ] Monetization decisions (take rates already seeded — confirm with finance)

---

## 9. Supply-side bootstrapping

- [ ] Minimum verified providers per priority category before customer push
- [ ] Seattle/King County channels + incentives
- [ ] Market data for range UI if enabled

---

## 10. Internal alpha

- [ ] Staging with seed data (`SEED_PASSWORD` for dogfood E2E)
- [ ] Support email **`support@no-markup.com`**
- [ ] Dispute / verification ops runbooks

---

## 11. Launch day

- [ ] Tag release only if `DEPLOY_PROVISIONED` path is real
- [ ] Migrations at **version 073** (or current max after this doc)
- [ ] All pods ready; smoke curls on **`no-markup.com`**
- [ ] First real transaction monitored end-to-end

---

## 12. Post-launch (first 48h)

- [ ] On-call; Sentry/Grafana; backups verified
- [ ] Liquidity KPIs baseline (targets, not guarantees)

---

## 13. Known gaps (must not ignore)

### Deploy / ops
- [ ] Deploy pipeline + secrets + NetworkPolicy selector fixes
- [ ] Terraform / external provisioner documented
- [ ] Migration Job on deploy
- [ ] Domain consistency: **only `no-markup.com`**

### Money / security (code)
- [ ] Track open P0s in `docs/planning/adversarial-action-tracker.md` — **do not take real money** until money + fail-closed items close

### Claims demoted (docs done; code optional)
- Feature flags fail-open on missing rows · mesh plaintext gRPC · secretbox not AES-GCM · coverage floors not 80% all stacks · no testcontainers · criterion not CI · k6 smoke optional only (not capacity proof) · no Husky · E2E CI backend-tolerant · North Star not achieved · SW kill-switch · RSC pilots not whole app · WCAG goal not axe-certified · insurance/legal flag-off · rank-estimate heuristic (not trained win-prob; FE-12 Done honesty) · GPS server geo-fence (FE-13 Done)

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering Lead | | | |
| Product Owner | | | |
| Security | | | |
| Operations | | | |
| Legal | | | |
