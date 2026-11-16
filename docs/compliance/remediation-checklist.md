# App Store Compliance Remediation Checklist

**Source audit:** `docs/compliance/app-store-review-2026-07-26.md`  
**Remediation date:** 2026-07-26  
**Goal:** Web product → **READY WITH FOLLOW-UPS** (packaging DEFERRED)

Status: `todo` · `in_progress` · `done` · `deferred` · `accepted_risk`

| ASR-ID | Priority | Workstream | Status | Evidence |
|--------|----------|------------|--------|----------|
| ASR-5.1.1.i | P0 | Legal | **done** | `web/src/app/(public)/privacy/page.tsx`, `/terms`, footer links |
| ASR-1.2.g | P0 | Legal | **done** | `community-guidelines/page.tsx` + admin takedown still present |
| ToS body_url | P0 | Legal | **done** | migration `108_tos_body_url_terms`; `compliance.go` → `/terms` |
| ASR-1.2.d | P0 | Legal | **done** | `/support` + footer + login/register links |
| ASR-1.5.a | P0 | Legal | **done** | Support URL `/support`; mailto support@no-markup.com |
| ASR-BYS.1 | P0 | Legal | **done** | Support contact path + app-review-notes ownership |
| ASR-1.2.a | P0 | UGC | **done** | `gateway/internal/contentfilter` wired on listing/job/chat/review/offer |
| ASR-1.2.b | P0 | UGC | **done** | ReportListingButton; job/provider ReportButton; FlagReviewButton |
| ASR-1.2.c | P0 | UGC | **done** | Chat block fail-closed 503; areUsersBlocked on bid/BIN/offer |
| ASR-1.1.3.b | P0 | UGC | **done** | weapons reason in contentfilter |
| ASR-1.4.3.c | P0 | UGC | **done** | substances reason in contentfilter |
| ASR-1.1.4 | P0 | UGC | **done** | sexual_content reason baseline |
| ASR-2.1.a.1 | P0 | Completeness | **done** | InsuranceClaimForm uses useImageUpload DOCUMENT → S3 |
| ASR-2.1.a.4 | P0/P2 | Completeness | **accepted_risk** (partial) | Insurance fixed; money races ADR accepted |
| Marketing/flags | P0 | Completeness | **done** | app-review-notes flag matrix; dual-rail docs |
| ASR-5.1.1.ii | P1 | Privacy | **done** | CookieConsent analytics default false |
| ASR-5.1.2.i | P1 | Privacy | **done** | Sentry enabled only with analytics consent |
| ASR-5.1.5 | P1 | Privacy | **done** | MarketSelector + CheckInOut purpose copy |
| ASR-5.1.1.v partial | P1 | Privacy | **done** | OAuth unlink API + ConnectedAccounts UI |
| ASR-5.1.2.vii | P1 | Privacy | **done** | Privacy mentions Apple Pay/Stripe; well-known placeholder |
| ASR-PRE-03 | P1 | Review docs | **done** | app-review-notes Support ownership |
| ASR-PRE-04 / BYS.2 | P1 | Review docs | **done** | app-review-notes demo accounts |
| ASR-PRE-06 / BYS.4 | P1 | Review docs | **done** | app-review-notes feature walkthrough |
| ASR-2.3.1.a.1 | P1 | Review docs | **done** | Flag matrix in app-review-notes |
| MON-14–18 | P2 | Money | **accepted_risk** | `adr-2026-07-26-money-integrity-residual.md` |
| ASR-3.1.1.* IAP | — | Packaging | **deferred** | `ios-payment-rails-design.md` |
| ASR-4.2 native shell | — | Packaging | **deferred** | No binary this run |
| ASR-3.2.1.viii licenses | — | Packaging | **deferred** | Flag-off guidance for iOS in dual-rail doc |
| mTLS mesh arming | — | Packaging | **deferred** | Code complete default-off (SEC-05 Done code); arming + certs still ops residual |
| DEPLOY_PROVISIONED | — | Packaging | **deferred** | Checklist only |
| Mobile web iPhone/iPad | P0 | UX | **done** | `ios-mobile-web-readiness.md`; nav/safe-area/dialog/TOC |
| Apple docs review | P1 | Process | **done** (Stage A) | Ph 0–4 logs + inventory + matrix; `launch-board.md` |

## Verification (2026-07-26)

```bash
cd gateway && go test ./internal/contentfilter/ ./internal/handler/ -count=1
cd web && npx vitest run tests/unit/components/compliance tests/unit/hooks/useCompliance.test.ts \
  tests/unit/hooks/useListingReports.test.ts tests/unit/hooks/useOAuthAccounts.test.ts \
  tests/unit/components/marketplace/ReportListingButton.test.tsx \
  tests/unit/components/insurance/InsuranceClaimForm.test.tsx
# → contentfilter + handler ok; 66 Vitest tests passed
```
