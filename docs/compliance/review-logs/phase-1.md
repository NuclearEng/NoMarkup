# Phase 1 — Policy lock (App Review Guidelines vs current product)

**Date:** 2026-07-26  
**Reviewer:** Grok (app-store-launch-readiness Stage A)  
**Guidelines source:** https://developer.apple.com/app-store/review/guidelines/  
**Skill snapshot:** `~/.grok/skills/app-store-compliance` (`source_snapshot` 2026-06-08)  
**Product under review:** NoMarkup monorepo — **web-first** marketplace (Next.js + Go/Rust). **No iOS/iPadOS Xcode target in tree.**

**Verdict this phase:**

| Surface | Readiness |
|---------|-----------|
| Web product policy / safety / privacy UX | **READY WITH FOLLOW-UPS** (post-remediation) |
| App Store **binary** submission | **NOT READY** — blocks listed in `submission-blockers.md` |

---

## 1.1 Introduction + Before You Submit

| Requirement | Product evidence | Binary impact | Status |
|-------------|------------------|---------------|--------|
| No cheating review / third-party SDK responsibility | Stripe, Mapbox, Sentry, OAuth; privacy discloses | Must list SDKs in privacy labels | PASS (web) / GAP (ASC labels) |
| Test for crashes | Vitest floors + Playwright smoke; full dogfood manual | Need device matrix | GAP ops |
| Metadata complete | Web SEO only; no ASC package | Blocks submit | **BLOCKER (binary)** |
| Contact for App Review | `support@no-markup.com`, `/support` | Monitor mailbox | PASS docs |
| Demo account / demo mode | Seed: customer/provider/admin + `SEED_PASSWORD` | MFA-safe review accounts + notes | PASS seed / GAP packaging |
| Backend live during review | `DEPLOY_PROVISIONED` fail-closed until provisioned | Staging always-on | **BLOCKER (ops)** |
| Review notes for non-obvious features | `app-review-notes.md` | Paste into ASC | PASS draft |
| HIG / platform docs | Mobile web HIG-ish; no native | Phase 2 + B0 | GAP native |

**ASR:** PRE-01–08, BYS.*

---

## 1.2 Safety (§1)

| Guideline | Product | Status |
|-----------|---------|--------|
| **1.1** Objectionable first-party content | Marketplace utility UI; no shock content | PASS |
| **1.1.3 / 1.4.3** Firearms, tobacco, controlled substances | `gateway/internal/contentfilter` create-time bans + community guidelines | PASS baseline (keyword; not ML) |
| **1.1.4** Sexual / exploitation | Filter reason `sexual_content` | PASS baseline |
| **1.2** UGC: filter, report, block, contact | contentfilter; report listing/user; block fail-closed on chat/bid/offer; `/support` | PASS |
| **1.2** Timely moderation response | Admin queues exist; SLA is ops | RISK ops (staffing) |
| **1.3** Kids | 18+ AgeGate; not Kids Category | N/A / PASS |
| **1.4** Physical harm / medical | Not a medical app | N/A |
| **1.5** Developer contact | Support URL + mailto | PASS |
| **1.6** Data security | secretbox PII, JWT, argon2id; gRPC mesh plaintext residual | RISK residual (mesh) |
| **1.7** Criminal reporting app | Platform T&S only | N/A |

**ASR:** 1.1.*, 1.2.*, 1.5, 1.6

---

## 1.3 Performance (§2)

| Guideline | Product | Status |
|-----------|---------|--------|
| **2.1** Completeness | Large web product; insurance S3 fixed; money races residual (ADR) | PASS web core / RISK money |
| **2.1** IAP complete | No StoreKit | **BLOCKER (binary)** for digital tiers |
| **2.2** Beta | Use TestFlight when binary exists | N/A now |
| **2.3** Accurate metadata | No ASC screenshots/description package | **BLOCKER (binary)** |
| **2.3.1** Hidden features / flags | Many flags; financial fail-closed; document in Review Notes | RISK → document review build flag map |
| **2.4.1** iPhone on iPad | Web responsive; no native multiplatform target | GAP native |
| **2.5.1** Public APIs only | Web uses browser APIs | GAP native scan |
| **2.5.5** IPv6 | Hostname clients; prod dual-stack unproven | RISK ops |
| **2.5.6** WebKit | If native embeds web, must use WebKit | GAP native design |
| **2.5.14** Recording consent | Camera/mic Permissions-Policy off; file pickers | PASS web |
| **2.5.18** Ads | No ad network product | N/A |

---

## 1.4 Business (§3) — critical path

| Guideline | Product | Status |
|-----------|---------|--------|
| **3.1.1** Digital unlock → IAP | Stripe subscriptions unlock analytics, featured, bid limits, etc. on **web** | PASS as **web commerce**; **BLOCKER on iOS binary** until StoreKit Rail B |
| **3.1.1** Restore | No StoreKit restore | **BLOCKER (binary)** |
| **3.1.2** Subscriptions ≥7d, ongoing value, disclosures | Monthly/annual tiers; web paywall copy | PASS product shape; Schedule 2/StoreKit disclosures GAP native |
| **3.1.3(e)** Physical goods & offline services → non-IAP | Stripe Connect escrow for jobs + goods | **PASS** (must preserve on iOS) |
| **3.1.3(b)** Multiplatform digital | Web Stripe tiers usable on any client with account | **BLOCKER** if iOS honors web sub without IAP offer |
| **3.1.3(d)** P2P 1:1 real-time | Real-world jobs awarded 1:1; not live digital group class | PASS as 3.1.3(e) offline services |
| **3.1.1(a)** External purchase links | Must not ship global “buy digital on web” CTA on non-US without entitlement | RISK native |
| **3.2.1(v)** Insurance | Per-job insurance Stripe; licensing thin | **Flag-off first iOS** |
| **3.2.1(viii)** Financial / advances / BNPL | Working capital + BNPL | **Flag-off first iOS** |
| **3.2.2(x)** Forced ratings | No App Store rating walls | PASS |

**Dual-rail (locked, do not re-litigate):**

| Rail | Method | Guideline |
|------|--------|-----------|
| A — GMV escrow, goods, offline services | Stripe / Apple Pay | **3.1.3(e)** |
| B — Digital platform tiers | StoreKit 2 on iOS; Stripe on web | **3.1.1 / 3.1.2** |

See `ios-payment-rails-design.md`. **No Stage B IAP code until Phase 4B review log.**

---

## 1.5 Design (§4)

| Guideline | Product | Status |
|-----------|---------|--------|
| **4.1** Copycats | Original NoMarkup brand | PASS |
| **4.2** Minimum functionality / not repackaged website | Rich web app; **no native shell** | PASS web; **BLOCKER if pure WKWebView binary** |
| **4.3** Spam / multi-bundle city apps | Single app, in-app geo | PASS |
| **4.5.4** Push | Soft prompts web; no production APNs app | PASS optional / do not claim in ASC if unimplemented |
| **4.8** Login Services | Email + Google + **Apple** + Facebook | PASS web |
| **4.9** Apple Pay | Stripe Payment Request; domain association **placeholder** | GAP production Apple Pay |
| **4.10** Monetize built-in OS | Not selling push/camera alone | PASS |

**ASR:** 4.2 is the #1 design risk for a rushed hybrid.

---

## 1.6 Legal (§5)

| Guideline | Product | Status |
|-----------|---------|--------|
| **5.1.1(i)** Privacy policy ASC + in-app | `/privacy` shipped; ASC URL not set | PASS web; GAP ASC |
| **5.1.1(ii)** Consent | Cookie opt-in; Sentry gated | PASS web |
| **5.1.1(v)** Account deletion | Settings + Erasure service + OAuth unlink | PASS |
| **5.1.2** Sharing / ATT | No IDFA tracking design; labels TBD | PASS intent; GAP ASC nutrition |
| **5.1.5** Location purpose | MarketSelector + check-in copy | PASS web; GAP Info.plist native |
| **5.1.1(ix) / 3.2** Regulated | Insurance, advances, legal vertical | **Flag-off iOS** until org + licenses |
| **5.2** IP | UGC ToS; partner SDKs | GAP formal license pack for review |
| **5.3** Gambling | Auctions are marketplace price discovery, not RMG | N/A (document in notes) |
| **5.6** Code of conduct | Consent defaults improved | PASS baseline |

Counsel should still review Privacy/Terms legal sufficiency (product baseline, not legal advice).

---

## 1.7 Supporting articles (spot-check)

| Doc | Relevance | Status |
|-----|-----------|--------|
| Account deletion support | Implemented | aligned |
| User privacy & data use | ASC labels next | todo Stage A3/B6 |
| Kids apps | N/A 18+ | confirmed N/A |
| Program License Agreement Schedule 2 | Subscription disclosures native | todo Stage A4b/B2 |

---

## Summary matrix (binary submission)

| Cluster | Web | First iOS binary |
|---------|-----|------------------|
| Safety UGC | OK | Port surfaces + keep server filters |
| Privacy policy / deletion | OK | Link + purpose strings + labels |
| Rail A Stripe GMV | OK | Keep non-IAP |
| Rail B digital tiers | Stripe OK on web | **StoreKit required** |
| Design 4.2 | N/A (Safari) | **Native app-like shell** |
| Regulated money | Web flags on | **Flag off** |
| ASC + demo + backend | Draft notes | **Must complete** |
| Money races MON-14–18 | Accepted residual | Flag-off risky rails or fix |

---

## Owners (from Phase 1)

| Gap | Owner type |
|-----|------------|
| iOS scaffold + 4.2 | Eng |
| StoreKit dual-rail | Eng + payments |
| ASC package / privacy labels | Eng + founder |
| Staging always-on for review | Ops |
| Insurance/lending licenses | Founder + counsel |
| Support mailbox monitoring | Ops |
| Privacy/Terms legal review | Counsel |

---

## Phase 1 exit criteria

- [x] Guidelines sections mapped to current product  
- [x] Open binary blockers explicit (see `submission-blockers.md`)  
- [x] Dual-rail confirmed (no re-litigation)  
- [ ] Full Stage A (Phases 2–4) — **not** claimed done this pause  
- [ ] `/app-store-compliance` re-run after Stage B — deferred  

**Next:** Stage A Phases 2–4 (HIG, privacy inventory, StoreKit/PassKit reads) **before** any B0/B2 code.
