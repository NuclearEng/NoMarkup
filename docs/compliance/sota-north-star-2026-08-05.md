# State-of-the-art north star (solo, capital-light)

**Date:** 2026-08-05  
**Context:** One founder + agents. Lightsail deferred. Local dogfood green.  
**Definition:** SOTA is **not** “every FAANG system.” It is **institutional quality where money, trust, and App Store touch humans** — with ops surface a solo operator can hold.

---

## 1. Scorecard (honest now vs SOTA)

| Domain | Now (approx) | SOTA bar | Gap type |
|--------|--------------|----------|----------|
| **Money correctness** | Strong: escrow, soft-id fail-soft, e2e 72/0/1 | Deterministic money gates in CI every PR; no 500s on missing Stripe ids; Radar + dispute runbook | CI + Live Stripe |
| **Stripe Connect** | Test keys live; Accounts v2 create; AccountSession API; soft acct_dev | Embedded onboarding default in **product** (iOS + web); Live mode; webhook on public `api` host | Product UX + origin |
| **iOS client** | Dual-rail design, Release https, unit 93/0, UI walk 5/5, device 3-role launch | Continuous device CI (or nightly); 0 soft-skip on critical Account rows; passkeys/MFA dogfood | Automation + hardware |
| **Web** | RSC pilots, CDN DATA pattern | Full RSC/data-cache discipline; RUM (web-vitals) field | Perf instrumentation |
| **Observability** | slog + OTel wired; Jaeger often down local | Always-on traces for money paths; alert on webhook lag + payment 5xx | Staging stack |
| **Security** | ATS clean Release; Keychain tokens; PII secretbox | mTLS mesh; no plaintext gRPC claim; secret rotation drill | Infra |
| **Deploy** | `deploy/prod` ready, Lightsail guide | One-command promote; smoke on every deploy; backups restore drill | Founder IP hour |
| **Search / ranking** | Meilisearch present | Relevance eval set + regression | Product |
| **Trust / fraud** | Engines exist | Online scores in every money CTA; explainability | Product wiring |

**Overall readiness today:** **YELLOW–GREEN for local dogfood**, **RED for public production** (no origin), **YELLOW for App Store** (product polish + review packaging).

---

## 2. SOTA principles (solo-optimized)

1. **Money paths never 500 on expected empty/stale state** — empty cards, not onboarded Connect, closed auctions → 2xx/4xx with clear UX.  
2. **Prove with commands** — e2e, UITest, device launch, red-team GET matrix.  
3. **One production shape** — Cloudflare + Lightsail + Compose (when resumed); K8s is graduation.  
4. **Automate what you’ll forget** — archive lint, e2e, soft-id tests, smoke scripts.  
5. **Don’t buy complexity** — no EKS/Firebase rewrite for prestige.  
6. **Ship narrative truth** — never claim GREEN UI 100% without evidence.

---

## 3. Priority ladder (do in this order)

### P0 — This week (no cloud required)
| # | Work | Why SOTA |
|---|------|----------|
| P0.1 | Keep **e2e 0 fail** + unit green on every payment/iOS change | Institutional CI culture |
| P0.2 | Clear seed `cus_dev_*` / `acct_dev_*` when using real Stripe (or provision real objects) | End soft-id debt |
| P0.3 | Account rows: stable **accessibilityIdentifier** on every NavigationLink | Unbreakable UI automation |
| P0.4 | GDPR export nullable `business_name` | Export reliability |
| P0.5 | Embedded Connect session **iOS** surface (or deep-link to web onboarding) | Connect SOTA UX |
| P0.6 | Money CTA: surface Stripe/network errors as typed UX (not “internal error”) | Trust |

### P1 — Before App Store submit
| # | Work |
|---|------|
| P1.1 | Public origin (Lightsail) + DNS + webhook on `api.no-markup.com` |
| P1.2 | TestFlight against **https** API |
| P1.3 | ASC packaging, screenshots, review notes (seed password in secure field only) |
| P1.4 | Privacy nutrition labels match reality |
| P1.5 | Crash-free dogfood week (Sentry DSN on device builds) |

### P2 — Before real money at scale
| # | Work |
|---|------|
| P2.1 | Stripe **Live** + Connect profile live + Radar |
| P2.2 | Nightly `backup-pg` + restore drill |
| P2.3 | Uptime + payment 5xx + webhook lag alerts |
| P2.4 | Staging environment (second Lightsail or namespace) |

### P3 — Unicorn ops (later)
| # | Work |
|---|------|
| P3.1 | Managed Postgres/Redis |
| P3.2 | EKS + Vault (`DEPLOY_PROVISIONED`) |
| P3.3 | Field RUM, experiment platform, multi-region |

---

## 4. “Really SOTA” product signals (user-felt)

- **Instant** catalog + bid feedback (optimistic UI + WS).  
- **Never lose money state** — idempotent PI/transfer/webhook.  
- **Provider onboarding** feels native (embedded Connect or seamless handoff).  
- **Errors teach** — “Add a card”, “Finish Stripe setup”, not 500.  
- **Trust visible** — scores, guarantees, dispute paths obvious.  
- **iOS feels native** — HIG, haptics, Dynamic Type, VoiceOver on money screens.

---

## 5. Anti-SOTA traps (do not do)

- Rewrite on Firebase “because mobile.”  
- EKS before first public dogfood.  
- Live Stripe before public webhook host.  
- Claiming 100/100 UI without device evidence.  
- Softening money authz to make tests green.

---

## 6. Immediate execution queue (agents)

1. GDPR nullable / export robustness  
2. Account `accessibilityIdentifier`s for critical rows  
3. Seed Stripe ID cleanup helper (dev only)  
4. Device 3-role relaunch (phone available)  
5. Re-run e2e + unit gates  

---

## 7. Success metric for next session

**SOTA local bar:**  
`e2e fail=0` · `unit fail=0` · ScreenshotWalk 5/5 · device 3-role launch · zero 5xx on red-team GET · calendar ICS 200 · no seed-induced Stripe 500s.

**SOTA public bar (later):**  
same + Lightsail origin + CF DNS + webhook delivery + TestFlight https.
