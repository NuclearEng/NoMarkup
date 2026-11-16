# SOTA Gap Closure Plan — NoMarkup

**Date:** 2026-08-04  
**Source:** Multi-agent SOTA review (UX, money, perf, competitive, eng)  
**Branch:** `fix/security-audit-2026-04-23`

## Goal

Close every **eng-closable** gap that blocks “best-in-class platform / Near-SOTA UX” claims. Document founder/ops and commercial proofs honestly — do not fake them.

## Status legend

| Status | Meaning |
|--------|---------|
| **Done** | Shipped this program |
| **In progress** | Active wave |
| **Planned** | Eng backlog, not this wave |
| **Founder** | Cannot close in-repo alone |
| **Won't** | Explicitly demoted / wrong path |

---

## Wave 0 — Plan + honesty (this doc)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| W0.1 | Publish this plan SSOT | Eng | **Done** |

---

## Wave A — P0 trust + docs truth

| ID | Item | Effort | Status |
|----|------|--------|--------|
| A1 | Docs: AES → secretbox; flags fail-closed prod; stale MON Open | S | **Done** |
| A2 | CLAUDE §15 flag fail-open language fix | S | **Done** |
| A3 | Document UI-only flags inventory + RequireFlag money keys list | S | **Done** |
| A4 | Mesh money: `MESH_PRIVILEGED_MONEY_PEERS` gate on release/refund | M | **Done** |

---

## Wave B — P0 unicorn UX

| ID | Item | Effort | Status |
|----|------|--------|--------|
| B1 | Goods sticky dock: real place-bid (amount + max + CTA), not scroll theater | M | **Done** |
| B2 | iOS listing proxy bid (`max_bid_cents` + UI) | M | **Done** |
| B3 | iOS sticky bid chrome on listing detail | M | **Done** — `safeAreaInset` dock |

---

## Wave C — P1 market desk

| ID | Item | Effort | Status |
|----|------|--------|--------|
| C1 | ⌘K v2: search live jobs/listings + UUID jump | M | **Done** |
| C2 | Active positions rail (`/me/positions`) | M | **Done** |
| C3 | Goods spectate: TerminalGrid + ascending adapter | M | **Done** (2026-08-04 wave) |
| C4 | Positions: goods bids + watchlist | S | **Done** |
| C5 | RequireFlag marketplace_offers + provider_business_os | M | **Done** |
| C6 | Seed `marketplace_offers` (mig 122) | S | **Done** |

---

## Wave D — P1 platform proof (eng)

| ID | Item | Effort | Status |
|----|------|--------|--------|
| D1 | WebVitalsReporter → document Sentry field path | S | **Done** |
| D2 | LHCI floor ratchet rule comment | S | **Done** |
| D3 | Goods review multi-dim | M | **Planned** (schema + both clients — not cheap) |

---

## Wave F — Founder (blocks production SOTA)

| ID | Item | Status |
|----|------|--------|
| F1 | DEPLOY_PROVISIONED + cluster + Vault/ESO | **Founder** |
| F2 | Cloudflare + auth cache-bypass | **Founder** |
| F3 | Live Stripe dogfood | **Founder** |
| F4 | Arm mTLS + peer allowlists on staging | **Founder** |
| F5 | Legal ToS for off-session charge | **Founder** |
| F6 | Security Gate branch protection + seed rotate | **Founder** |
| F7 | 90-day pilot density metrics | **Founder / market** |

---

## Wave X — Won't chase

- Edge-cache HTML under CSP nonce  
- Criterion as e2e bid p99  
- Full ONNX fraud for eng-max claim  
- Android before pilot  

---

## Execution order

1. Wave A + B in parallel  
2. Wave C  
3. Commit + push  
4. Founder checklist handoff  

## Definition of done (eng)

- [x] Sticky goods bid places bid from dock  
- [x] iOS max bid ships  
- [x] Docs no longer claim AES-GCM / prod fail-open flags  
- [x] Command palette can jump to live market entities  
- [x] Positions surface exists  
- [x] Goods TerminalGrid spectate  
- [x] marketplace_offers + provider_business_os API-gated  
- [x] Plan statuses updated  

Commercial / production SOTA remains Founder + pilot (Wave F).
