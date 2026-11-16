# Phase 3 — Privacy purpose strings + data inventory

**Date:** 2026-07-26  
**Stage:** App Store launch readiness — Stage A Phase 3  
**Reviewer:** Grok (subagent)  
**Status:** **done**

**Deliverable:** [`docs/compliance/privacy-purpose-string-inventory.md`](../privacy-purpose-string-inventory.md)

**Constraints honored:** Docs under `docs/compliance/` only; no Stage B native code.

---

## 1. Summary of inventory

Mapped the **current web marketplace** (services reverse-auction + goods forward-auction) to future iOS packaging:

| Area | Web evidence | Future iOS packaging impact |
|------|--------------|-----------------------------|
| Account (email, password, display name, phone) | Register/login/profile; argon2id; phone encrypted | Standard contact fields in ASC labels; no special plist |
| Age / DOB | `AgeGate` + server ≥18 | Keep gate; DOB encrypted, not public |
| OAuth Google / Apple / Facebook | Gateway OAuth + unlink API | SIWA required if other social login on binary (4.8) |
| Location | MarketSelector purpose copy; GPS check-in required; Mapbox; coarsened public map | `NSLocationWhenInUseUsageDescription` + pre-prompts |
| Media uploads | 6 contexts: avatar, portfolio, job_photo, document, review_photo, listing | Photo library purpose string; camera **off** today |
| Camera / mic | Permissions-Policy deny both | Do not declare mic; camera only if Stage B enables |
| Payments | Stripe Elements + Payment Request (Apple Pay path) | PassKit/Stripe; no PAN; physical goods non-IAP path preserved |
| UGC | Jobs, listings, chat, reviews + filter/report/block | User Content labels + 1.2 safety already remediated |
| Diagnostics | Sentry consent-gated; no session replay | Diagnostics labels; not tracking |
| Cookies | Necessary + opt-in analytics/marketing | Native settings toggle analog |
| Push | Soft prompt + VAPID partial | APNs + soft pre-prompt |
| Address / service PII | secretbox fields + coarsened geometry | Physical Address + Location labels |
| Export / deletion | Settings Account; 30-day grace; JSON export | Guideline 5.1.1(v) in-app deletion must remain |

**Inventory table rows:** **38** (see deliverable §1).

Also produced: consolidated draft Info.plist keys, ASC roll-up, pre-prompt checklist, known gaps.

---

## 2. ATT decision

| Decision | **ATT not required (N)** for current product model |
|----------|-----------------------------------------------------|
| Rationale | No IDFA, no ad network SDK, no cross-app advertising identifier. Sentry + optional analytics are first-party product diagnostics under cookie consent, not Apple “tracking.” Marketing consent is recommendations-oriented, not IDFA. |
| Ship `NSUserTrackingUsageDescription`? | **No** |
| Ship ATT prompt? | **No** |
| Re-open when | Any MMP, Meta/Google Ads SDK, IDFA measurement, or data-broker sharing is introduced |

---

## 3. Gaps for Stage B1 (native packaging)

These are **packaging/implementation** follow-ups, not Phase 3 doc failures:

1. **Create real Info.plist keys** only for APIs the binary calls (location, photos; camera only if enabled).
2. **Port pre-prompts** from MarketSelector, CheckInOut, PushPermission, AgeGate, CookieConsent into native UI before OS dialogs.
3. **Sign in with Apple** if Google/Facebook login ships on iOS (Guideline 4.8).
4. **In-app account deletion + privacy link** parity with web Settings (5.1.1(v)).
5. **ASC App Privacy questionnaire** filled from inventory §3 against actual SDKs (Stripe, Mapbox, Sentry, OAuth, APNs).
6. **Do not enable ATT** without a tracking use case.
7. **Camera:** web denies via Permissions-Policy — Stage B must consciously enable + purpose string + pre-prompt if capture is desired.
8. **Apple Pay:** real merchant domain association before claiming live Apple Pay (remediation residual).
9. **Push:** replace web SW kill-switch posture with production APNs path when shipping notifications.
10. **PII note for legal/ASC:** `provider_profiles.service_location` exact plaintext remains a documented platform limitation.

**Out of Phase 3 / Stage A:** StoreKit dual-rail, Xcode target, deploy provisioning — still deferred (see Phase 1 / submission blockers).

---

## 4. Sources consulted (evidence pass)

- `web/src/components/compliance/{CookieConsent,AgeGate}.tsx`
- `web/src/components/location/MarketSelector.tsx`, `providers/CheckInOut.tsx`
- `web/src/hooks/{useImageUpload,useWorkspace}.ts`, `lib/web-push.ts`, `instrumentation-client.ts`
- `web/next.config.ts` Permissions-Policy; `gateway/internal/middleware/security.go`
- `gateway/internal/handler/{oauth,oauth_facebook,oauth_accounts,data_export,image,user}.go`
- `web/src/app/(public)/privacy/page.tsx`, settings account page
- `docs/compliance/app-store-review-2026-07-26-remediated.md`
- Claude.md PII encryption inventory

---

## 5. Status

| Item | Status |
|------|--------|
| `privacy-purpose-string-inventory.md` | **Written** |
| ATT recommendation | **N — do not implement ATT** |
| Inventory row count | **38** |
| Stage B native code | **Not started** (by design) |
| Phase 3 | **done** |
