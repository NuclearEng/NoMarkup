# App Store Compliance Report (re-audit)

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup` (native iOS `ios/NoMarkup`, bundle `com.nomarkup.app`)
- **Date**: 2026-08-21 (re-audit after agent-team remediations)
- **Prior report**: [`app-store-review-2026-08-21.md`](./app-store-review-2026-08-21.md)
- **Guidelines snapshot**: 2026-06-08 ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)) — 74 days old (within 90-day window)
- **Platform / posture**: **ios** · App Store (not notarization-priority)
- **Submission readiness**: **NOT READY**

> Code-addressable FAILs from the morning audit are closed or demoted. Remaining **blocker FAILs are founder/ops only**: live review API, ASC demo password, ASC listing/URLs. Design section is clean (0 FAIL / 0 RISK / 0 GAP).

---

## Applicability profile

Unchanged from the morning audit. Native iOS marketplace: UGC, accounts, SIWA + Google/Facebook, location, Apple Pay, push, widgets, physical goods + p2p services, flag-gated regulated rails, StoreKit scaffold off, 18+ age gate. Not kids/medical/crypto/gambling/VPN/ads/tracking.

---

## Delta vs morning audit

| ID | Was | Now | Why |
|----|-----|-----|-----|
| ASR-1.2.b | **FAIL** blocker | **RISK** | Job report API + iOS/web UI + migration 130 shipped; no resolve UI/SLA/live host |
| ASR-1.2.1.d | **FAIL** blocker | **RISK** | Age gate fail-closed; no mature image labels |
| ASR-1.4.3.c | RISK | **PASS** | Cannabis/THC/paraphernalia in contentfilter + Community Guidelines §3 |
| ASR-1.4.3.b | RISK | **PASS** | Login + fail-closed 18+ |
| ASR-3.2.1.viii | **FAIL** blocker | **RISK** | `iOSHardOffKeys` + migration 129; purchase cannot fire; disabled forms still visible |
| ASR-3.2.2.ix.1 | **FAIL** blocker | **RISK** | Same; APR UI not built because rail is off |
| ASR-3.2.2.ix.2 | **FAIL** blocker | **RISK** | Server all-in math still >36% if re-enabled |
| ASR-4.5.4.marketing | **FAIL** major | **PASS** | Dedicated marketing consent; promo push seeds off |
| ASR-4.9.branding | **FAIL** major | **PASS** | `PayWithApplePayButton` on Buy now / Pay order |
| ASR-4.9.recur.* | RISK | **PASS** | Recurring disclosure helper next to first charge |
| ASR-4.4 | GAP | **PASS** | Account widget help + review-notes paste block |
| ASR-2.3.1.a.1 | RISK | **GAP** | Hard-off prevents remote enablement; ASC notes unpasted |
| ASR-5.1.1.i | GAP | **GAP** | Equal-protection sentence added; ASC Privacy URL still missing |
| ASR-5.1.1.ix | RISK | **GAP** | Rails not offered in this binary; org enrollment unknown |
| ASR-BYS.3 / PRE-05 / 2.1.a.1 / PRE-04 / PRE-02 / PRE-03 | FAIL | **FAIL** | Founder/ops — cannot close in git |

---

## Executive summary

| Metric | Morning | Re-audit |
|--------|---------|----------|
| **Blocker FAIL** | 9 | **4** |
| **Major FAIL** | 4 | **2** |
| **Advisory FAIL** | 0 | **0** |
| **RISK** | 16 | **13** |
| **GAP** | 34 | **~34** (mostly ASC/metadata; 2.3.1.a.1 added as GAP) |
| **PASS** | 167 | **173** |
| **N/A** | 138 | **141** |
| **Submission readiness** | NOT READY | **NOT READY** (ops only) |

### Tests run this re-audit

- `gateway` `contentfilter` + `job_reports` handler tests: **pass**
- Vitest `ReportJobButton.test.tsx`: **2/2 pass**
- iOS Simulator iPhone 17 Pro: `AppConfigTests` (incl. hard-off keys), `AgeGateMathTests` (fail-closed), `NotificationPreferencesTests`: **TEST SUCCEEDED**

### Top 5 remaining actions (all founder/ops except #5)

1. Provision `https://api.no-markup.com` + seed demo accounts with 18+ DOB; put password **only** in ASC — **ASR-PRE-05 / ASR-BYS.3 / ASR-PRE-04**.
2. Create ASC app record; screenshots 6.9″ + 13″; Privacy Policy URL; nutrition labels; contact — **ASR-2.1.a.1 / PRE-02 / PRE-03 / 5.1.1.i**.
3. Paste [`app-review-notes.md`](./app-review-notes.md) into App Review Notes — **PRE-06 / 3.0.1 / 2.3.1.a.2**.
4. Sign device-smoke matrix — **PRE-01 / 2.1.a.2**.
5. Optional code follow-ups (not blockers): hide disabled loan/instant-payout forms; image NSFW/CSAM scan; ignore web Stripe Pro on iOS until StoreKit.

---

## Findings

Ordered **blocker FAIL → major FAIL → RISK → GAP**. PASS in appendix counts only.

### Blocker FAIL (ops)

### [ASR-BYS.3] Backend must be live during review
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Enable backend services so they are live and accessible during App Review.
- Evidence: `docs/operations/provisioning-checklist.md` **NOT YET PROVISIONED**. Review notes still say `https://api.no-markup.com` is not live. Deploy fail-closed until `DEPLOY_PROVISIONED=true`.
- Remediation: Provision review API + seed + migration 129; keep report/block/age-status up for the review window.
- Confidence: 10

### [ASR-PRE-05] Backend services live during review
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Backend services must be live and accessible during review.
- Evidence: Same host as BYS.3. Release `Info.plist` `APIBaseURL` empty → `AppConfig.productionAPIBaseURL`.
- Remediation: Same as BYS.3.
- Confidence: 9

### [ASR-PRE-04] Full access / demo account
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Provide App Review full access, including an active demo account or fully-featured demo mode.
- Evidence: Seed emails in `docs/compliance/app-review-notes.md`. Password not in git (correct) and **not in ASC**. Fail-closed age gate requires pre-verified 18+ DOB on the review host.
- Remediation: Seed review env; no MFA; verified DOB; password only in ASC Password field.
- Confidence: 8

### [ASR-2.1.a.1] Final binary + complete metadata and live URLs
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: Submissions must be final versions with all necessary metadata and fully functional URLs.
- Evidence: `submission-blockers.md` rows 1–12: no ASC record, screenshots, nutrition labels, or review contact. `no-markup.com` / `api.no-markup.com` unprovisioned. Binary chrome is complete (`RootTabView`).
- Remediation: Live zone HTTP 200 for Privacy/Support/Marketing; ASC record; in-app screenshots; paste notes.
- Confidence: 9

### Major FAIL (ops)

### [ASR-PRE-02] Complete and accurate App Store metadata
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Ensure all app information and metadata is complete and accurate.
- Evidence: Drafts in `asc-packaging-checklist.md` only. ASC listing not created.
- Remediation: Enter name/subtitle/description/keywords/categories; upload 6.9″ + 13″; age rating + App Privacy labels.
- Confidence: 9

### [ASR-PRE-03] App Review contact current
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Keep contact information updated so App Review can reach the developer.
- Evidence: Intended `support@no-markup.com`. ASC email/phone `[~]`.
- Remediation: Enter and staff ASC contact email + phone during review.
- Confidence: 8

---

### RISK (code residual / legal gray)

### [ASR-1.1.4] Sexual / pornographic / exploitation content
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Do not include overtly sexual or pornographic material.
- Evidence: Text blocklist on writes (`gateway/internal/contentfilter/filter.go`). `engines/imaging` is decode/resize/EXIF/BlurHash only — **no NSFW/CSAM classifier**. Photos can post with clean captions.
- Remediation: Vendor CSAM/NSFW on listing/job/profile/review/chat media; fail closed on scanner errors for new uploads.
- Confidence: 8

### [ASR-1.2.b] Report offensive content + timely handling
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: UGC apps must provide a mechanism to report offensive content and timely responses.
- Evidence: **Intake shipped:** `POST /api/v1/jobs/{id}/report`, migration 130 (auto-hide at ≥3 attributable reports), iOS `JobReportSheet`, web `ReportJobButton`. Listings/users/chat/reviews already reported. **Ops:** admin list only (no resolve route/UI); no SLA; backend not live.
- Remediation: Admin resolve + `/admin/job-reports` queue; staff SLA; keep APIs up in review.
- Confidence: 7

### [ASR-1.2.f] Incidental NSFW hidden by default
- Status: RISK
- Severity: major
- Notarization: no
- Rule: Incidental mature NSFW from a web service may display only if hidden by default.
- Evidence: Same catalog as web; no blur/NSFW preference; photos unclassified.
- Remediation: Default-hide mature media; website-only mature toggle; scan uploads.
- Confidence: 7

### [ASR-1.2.1.d] Age labels + restriction for creator content
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Identify content that exceeds the app’s age rating; restrict underage users via verified or declared age.
- Evidence: Fail-closed `AgeGateMath.decision` + `AgeStatusBlockedView`. Login required before catalog. No per-item mature badges; photos still unscanned. DEBUG scaffold still hides the gate.
- Remediation: Keep fail-closed in Release; add image scan or mature labels; seed demo DOB verified.
- Confidence: 7

### [ASR-BYS.5] Ongoing support
- Status: RISK
- Severity: major
- Notarization: no
- Rule: App must continue to function and be actively supported.
- Evidence: In-app Support URL; production mailbox/zone not provisioned.
- Remediation: Live Support URL; staff `support@no-markup.com`.
- Confidence: 7

### [ASR-3.1.3.b.1] Multiplatform digital items must also be IAP
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Multiplatform apps may honor website purchases only if those items are also available as IAP.
- Evidence: Web still sells Pro/Business via Stripe. iOS `StoreKitEnabled=false`. iOS does not call `CheckFeatureAccess`; server still honors Stripe rows for any client.
- Remediation: Ignore Stripe digital entitlements for iOS until StoreKit products exist; or ship IAP parity.
- Confidence: 7

### [ASR-3.2.1.v] Insurance apps: free, licensed, no IAP
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Insurance apps must be free, legally compliant, and cannot use IAP.
- Evidence: Hard-off + 129; quote/purchase hidden when disabled. Account still lists Insurance quote. No licenses.
- Remediation: Keep off until licensed; hide Account/hub insurance rows when hard-off.
- Confidence: 7

### [ASR-3.2.1.viii] Financial services submitted by licensed institution
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Money-management apps should be submitted by the licensed institution.
- Evidence: Purchase cannot fire (`iOSHardOffKeys` + 129). Hub still navigates to BNPL / Request advance / instant payout with **visible disabled** money CTAs.
- Remediation: Hide (don’t only disable) those forms until a licensed partner.
- Confidence: 7

### [ASR-3.2.2.ix.1] Personal loan APR and due date
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Disclose max APR and due date before commitment.
- Evidence: Not purchasable on iOS. `AdvancesView` still shows disabled Request advance with no APR decode.
- Remediation: Hide the form while off; if enabled, show all-in APR + due date.
- Confidence: 8

### [ASR-3.2.2.ix.2] Maximum all-in APR ≤ 36%
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Loan apps may not charge a maximum APR higher than 36% including costs and fees.
- Evidence: Not completable on iOS. Server: 15% interest ceiling + 3% origination over 30 days would exceed 36% all-in if enabled.
- Remediation: Recast/cap before any enablement. Hard-off is not a pricing fix.
- Confidence: 7

### [ASR-3.2.2.ix.3] No required full repayment in 60 days or less
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Loan apps may not require repayment in full in 60 days or less.
- Evidence: Server `defaultAdvanceTermDays = 30`. MCA vs personal loan still ambiguous.
- Remediation: Hide form while off; if personal loan, term > 60 days or counsel-document commercial holdback.
- Confidence: 6

### [ASR-5.0] Comply with law; no criminal facilitation
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Apps must comply with all legal requirements where made available.
- Evidence: US storefront; 18+ fail-closed; community guidelines; regulated rails hard-off. No counsel memo in tree.
- Remediation: Counsel sign-off before any insurance/lending/BNPL/legal enablement.
- Confidence: 7

### [ASR-5.2.1] Submitter owns IP
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Submitter owns or has licensed the IP.
- Evidence: Brand NoMarkup; UGC license in Terms §4. Legal entity vs Individual not evidenced.
- Remediation: Submit under the company that owns the mark; match ASC seller name.
- Confidence: 6

---

### Selected GAP (blocker / major)

### [ASR-5.1.1.i] Privacy policy in ASC and in-app
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: Privacy policy in ASC **and** in-app; collection/uses, third-party equal protection, retention/deletion.
- Evidence: **Policy text remediated** (`privacy/page.tsx` §4 equal-protection sentence, LAST_UPDATED 21 Aug 2026). In-app Account + Login + deletion links. **ASC URL not entered**; live zone not proven.
- Remediation: Set ASC Privacy Policy URL to `https://no-markup.com/privacy`; confirm the zone serves the Next route.
- Confidence: 9

### [ASR-BYS.2] Demo account / review access
- Status: GAP
- Severity: blocker
- Notarization: no
- Rule: Provide App Review full access including a demo account.
- Evidence: Seed emails documented; password not in ASC; host unproven. Overlaps PRE-04.
- Remediation: Seed + ASC password field + verified 18+ DOB.
- Confidence: 8

### [ASR-2.3.1.a.1] No hidden / dormant / undocumented features
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: Do not include hidden, dormant, or undocumented features.
- Evidence: `iOSHardOffKeys` populated; migration 129; review notes disclose rails off. Hub still shows labeled-off finance shells. Notes not in ASC.
- Remediation: Paste notes; optionally hide purchase destinations when hard-off.
- Confidence: 8

### [ASR-2.1.a.2] On-device test
- Status: GAP · blocker · device-smoke matrix unsigned.

### [ASR-2.1.a.3] Demo + live backend
- Status: GAP · blocker · same as PRE-04/05.

### [ASR-2.3.1.a.3] Misleading marketing
- Status: GAP · blocker · draft What’s New claims Apple Pay; domain/`pk_` founder residual.

### [ASR-PRE-01] Test for crashes
- Status: GAP · major · simulator tests exist; device matrix unsigned.

### [ASR-PRE-06] Review notes
- Status: GAP · major · paste block complete in git, not in ASC.

### [ASR-5.1.1.ix] Regulated entity
- Status: GAP · blocker · rails not offered; org enrollment unknown.

### [ASR-5.6.2] Developer identity
- Status: GAP · major · ASC seller name not filled.

Metadata GAPs (screenshots, keywords, subtitle, age rating, What’s New, IPv6, IAP explanation, category): unchanged founder/ASC work — see morning report and `asc-packaging-checklist.md`. Advisory POST-01…07 still GAP (no submission yet).

---

## Pre-submit operational checklist

| ID | Status | Notes |
|----|--------|-------|
| ASR-PRE-01 | **GAP** | Unit/UITest exist; device-smoke unsigned |
| ASR-PRE-02 | **FAIL** | No ASC record |
| ASR-PRE-03 | **FAIL** | ASC contact not entered |
| ASR-PRE-04 | **FAIL** | Demo password not in ASC; host unproven |
| ASR-PRE-05 | **FAIL** | `api.no-markup.com` not provisioned |
| ASR-PRE-06 | **GAP** | Notes content ready; not pasted |
| ASR-PRE-07 | **PASS** | Native SwiftUI, SIWA, SFSafari, PaymentSheet + PayWithApplePayButton |
| ASR-PRE-08 | **PASS** | Active repo + in-app Support |

---

## Registry coverage

| Section | Items | Applicable | PASS | FAIL | RISK | GAP | N/A |
|---------|-------|------------|------|------|------|-----|-----|
| Safety | 52 | 33 | 25 | 1 | 5 | 2 | 19 |
| Performance | 99 | 57 | 38 | 1 | 0 | 18 | 42 |
| Business | 80 | 61 | 54 | 0 | 6 | 1 | 19 |
| Design | 70 | 28 | **28** | **0** | **0** | **0** | 42 |
| Legal | 66 | 47 | 28 | 4 | 2 | 13 | 19 |
| **Total** | **367** | **226** | **173** | **6** | **13** | **34** | **141** |

All five sections run. Scope: full.

### Code remediations landed (this session)

- `FeatureFlags.iOSHardOffKeys` — 7 regulated keys; migration `129_disable_regulated_feature_flags`
- Age gate fail-closed (`AgeGateMath.decision` + `AgeStatusBlockedView`)
- Job reports: `130_job_reports`, `POST /api/v1/jobs/{id}/report`, iOS + web UI
- Cannabis blocklist + Community Guidelines
- Marketing push consent
- `PayWithApplePayButton` + recurring Apple Pay disclosures
- Privacy equal-protection sentence; widget help; review notes paste block

---

## Disclaimer

This audit maps product evidence to Apple’s published App Store Review Guidelines.
It is not legal advice and does not guarantee App Review approval. Guidelines are a
living document; re-verify against the canonical URL before submission.
