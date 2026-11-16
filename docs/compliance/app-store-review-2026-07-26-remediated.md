# App Store Compliance Report (Post-Remediation Delta)

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup`
- **Date**: 2026-07-26 (remediation close)
- **Baseline audit**: `docs/compliance/app-store-review-2026-07-26.md` (NOT READY)
- **Guidelines snapshot**: 2026-06-08
- **Platform / posture**: **web** · packaging prep docs only
- **Submission readiness (web product policy surface)**: **READY WITH FOLLOW-UPS**
- **Submission readiness (App Store binary)**: **NOT READY** (DEFERRED — no iOS binary, no StoreKit)
- **Mobile web (iPhone/iPad Safari)**: **READY WITH FOLLOW-UPS** — see `ios-mobile-web-readiness.md`

---

## Delta vs baseline (2026-07-26 initial)

| ASR-ID | Was | Now | Evidence |
|--------|-----|-----|----------|
| ASR-5.1.1.i | FAIL | **PASS** | `/privacy` page; footer; settings links |
| ASR-1.2.g | RISK | **PASS** | `/community-guidelines` + existing admin queues |
| ToS body_url | FAIL | **PASS** | migration 108; `compliance.go` → `/terms` |
| ASR-1.2.d / 1.5.a / BYS.1 | FAIL | **PASS** | `/support` + mailto + footer |
| ASR-1.2.a | FAIL | **PASS** | `contentfilter` on listing/job/chat/review/offer |
| ASR-1.2.b | FAIL | **PASS** | Report listing/job/provider + flag review |
| ASR-1.2.c | RISK | **PASS** | fail-closed chat; bid/BIN/offer block checks |
| ASR-1.1.3.b / 1.4.3.c / 1.1.4 | RISK | **PASS** | keyword filter reasons |
| ASR-2.1.a.1 | FAIL | **PASS** | InsuranceClaimForm S3 via useImageUpload |
| ASR-2.1.a.4 | FAIL | **accepted_risk** | Insurance fixed; MON-14–18 ADR |
| ASR-5.1.1.ii / 5.1.2.i | GAP | **PASS** | analytics opt-in default; Sentry gated |
| ASR-5.1.5 | GAP | **PASS** | location purpose copy |
| ASR-5.1.1.v social unlink | GAP | **PASS** | OAuth accounts API + UI |
| ASR-5.1.2.vii | GAP | **PASS** | policy + well-known placeholder |
| PRE-03/04/06, BYS.2/4, 2.3.1.a.1 | GAP | **PASS** (docs) | `app-review-notes.md` |
| ASR-3.1.1.* IAP packaging | FAIL | **DEFERRED** | `ios-payment-rails-design.md` |
| ASR-4.2 native shell | RISK | **DEFERRED** | no binary |
| ASR-3.2.1.viii / 5.1.1.ix licenses | RISK | **DEFERRED** | iOS flag-off guidance; web disclosed |

### Counts (web in-scope)

| Metric | Baseline | After remediation |
|--------|----------|-------------------|
| In-scope blocker FAIL (web) | 8+ | **0** |
| In-scope major FAIL (web) | several | **0** |
| Accepted residual | — | money races (ADR) |
| Deferred packaging | — | IAP, native shell, licenses, deploy, mTLS |

---

## Applicability profile

Unchanged from baseline (web marketplace, UGC, location, OAuth, Stripe physical + SaaS subs, insurance, financial features).

---

## Executive summary

**Web product** now has:

1. Published **Privacy, Terms, Community Guidelines, Support**
2. **Pre-post UGC filters** and fuller **report/block** surfaces
3. **Insurance claim evidence** uploaded via real image pipeline
4. **Consent-gated analytics/Sentry** and location purpose UX
5. **OAuth disconnect** and App Review notes package

**Still not App Store binary-ready:** StoreKit dual-rail, native shell, production deploy, regulated licenses — documented as DEFERRED.

**Follow-ups:** money integrity MON-14–18 (ADR accepted for this exit); operational Support mailbox monitoring; replace Apple Pay domain association placeholder before live Apple Pay.

---

## Findings (post-remediation, in-scope only)

### PASS (closed this run)

#### [ASR-5.1.1.i] Privacy policy in-app + linkable

- Status: **PASS**
- Severity: blocker
- Evidence: `web/src/app/(public)/privacy/page.tsx`; footer in `(public)/layout.tsx`; settings account privacy card; Stripe/Mapbox/Sentry/OAuth/deletion covered in copy.
- Confidence: 9

#### [ASR-1.2.a] Pre-post UGC filter

- Status: **PASS**
- Severity: blocker
- Evidence: `gateway/internal/contentfilter`; wired in listings_write, job, chat, review, offers; unit tests in contentfilter package.
- Confidence: 8

#### [ASR-1.2.b] Report mechanisms

- Status: **PASS**
- Severity: blocker
- Evidence: `ReportListingButton` on ListingDetailClient; ReportButton on JobDetailClient + ProviderProfileClient; FlagReviewButton; admin goods-reports / user-reports unchanged.
- Confidence: 9

#### [ASR-1.2.c] Block abusive users

- Status: **PASS**
- Severity: blocker
- Evidence: `chat.go` fail-closed 503 on block DB error; `areUsersBlocked` on PlaceListingBid, BuyItNow, CreateOffer, UpdateOffer.
- Confidence: 9

#### [ASR-1.2.d / 1.5.a] Support contact

- Status: **PASS**
- Severity: major
- Evidence: `/support`, SupportContactForm mailto, footer + login/register links.
- Confidence: 9

#### [ASR-2.1.a.1] No placeholder insurance evidence

- Status: **PASS**
- Severity: blocker
- Evidence: `InsuranceClaimForm.tsx` uses `useImageUpload` DOCUMENT context → confirmed URLs.
- Confidence: 9

#### [ASR-5.1.1.ii / 5.1.2.i] Consent + analytics

- Status: **PASS**
- Severity: blocker
- Evidence: CookieConsent analytics default `false`; `instrumentation-client.ts` Sentry `enabled` only with analytics consent.
- Confidence: 9

#### [ASR-5.1.5] Location purpose

- Status: **PASS**
- Severity: blocker
- Evidence: MarketSelector purpose text; CheckInOut purpose + clearer GPS errors.
- Confidence: 8

#### [ASR-5.1.1.v] Account deletion (prior) + social unlink (new)

- Status: **PASS**
- Severity: blocker
- Evidence: prior deletion path; new `oauth_accounts.go` GET/DELETE + ConnectedAccounts UI; lockout prevention tests.
- Confidence: 9

### Accepted residual

#### [ASR-2.1.a.4] Incomplete money integrity

- Status: **accepted_risk**
- Severity: blocker (residual)
- Evidence: ADR `docs/compliance/adr-2026-07-26-money-integrity-residual.md`; MON-14–18 remain Open in adversarial tracker; insurance placeholder closed.
- Remediation: payment sprint; flag-off BNPL/advances for constrained launch.
- Confidence: 8

### DEFERRED (packaging — not fake PASS)

| ID | Rationale |
|----|-----------|
| ASR-3.1.1.1 / .2 / .5 / 3.1.2.* / 3.1.3.b.1 | Digital tiers still Stripe; design in `ios-payment-rails-design.md` |
| ASR-4.2 thin WebView | No native shell built |
| ASR-3.2.1.viii / 5.1.1.ix | No licenses minted; iOS flag-off recommended |
| PRE-05 / DEPLOY_PROVISIONED | Cluster not provisioned this run |
| mTLS mesh | Residual SEC-05 |
| ASC screenshots / StoreKit restore | No App Store Connect project |

---

## Pre-submit operational checklist

| ID | Status | Notes |
|----|--------|-------|
| ASR-PRE-01 | GAP residual | Strong unit tests; full live dogfood still manual |
| ASR-PRE-02 | GAP residual | No ASC package (packaging) |
| ASR-PRE-03 | **PASS** (docs) | Support ownership in app-review-notes |
| ASR-PRE-04 | **PASS** (docs) | Demo accounts documented |
| ASR-PRE-05 | **DEFERRED** | Staging/prod uptime ops |
| ASR-PRE-06 | **PASS** (docs) | Review notes file |
| ASR-PRE-07 | DEFERRED | Native HIG when shell exists |
| ASR-PRE-08 | **PASS** (docs) | Support path shipped; mailbox ops human |

---

## Registry coverage

Sections re-scored against remediation evidence (orchestrator synthesis; not five full re-agents). In-scope web FAIL/RISK from baseline closed or accepted with ADR/docs.

**Artifacts**

| Path | Role |
|------|------|
| `docs/compliance/remediation-checklist.md` | Living ASR map |
| `docs/compliance/app-review-notes.md` | Demo + flags + rails |
| `docs/compliance/ios-payment-rails-design.md` | Deferred StoreKit dual-rail |
| `docs/compliance/adr-2026-07-26-money-integrity-residual.md` | Money races accept |

---

## Definition of done check

| Criterion | Met? |
|-----------|------|
| In-scope ASR IDs PASS or accepted_risk with owner/date | **Yes** (checklist) |
| Zero remaining in-scope **web** blocker FAIL | **Yes** (money = accepted_risk not untracked FAIL) |
| Readiness ≥ READY WITH FOLLOW-UPS for web | **Yes** |
| Packaging DEFERRED explicit | **Yes** |
| Closed FAILs cite real ASR IDs | **Yes** |

---

## Disclaimer

This audit maps product evidence to Apple’s published App Store Review Guidelines. It is **not legal advice** and does **not** guarantee App Review approval. Privacy/Terms copy is a product compliance baseline — counsel review recommended before production launch. Packaging findings remain until an iOS binary and StoreKit dual-rail ship.
