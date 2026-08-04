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
| B3 | iOS sticky bid chrome on listing detail | M | **Partial** — form section always visible; true safe-area overlay deferred |

---

## Wave C — P1 market desk

| ID | Item | Effort | Status |
|----|------|--------|--------|
| C1 | ⌘K v2: search live jobs/listings + UUID jump | M | **Done** |
| C2 | Active positions rail (`/me/positions`) | M | **Done** |
| C3 | Goods spectate: AnimatedPrice + mono densify | M | **Done** |

---

## Wave D — P1 platform proof (eng)

| ID | Item | Effort | Status |
|----|------|--------|--------|
| D1 | WebVitalsReporter → document Sentry field P75 path + env | S | Planned / partial |
| D2 | LHCI floor comment ratchet note (not break CI) | S | Planned |
| D3 | Goods review multi-dim (if cheap) | M | Planned if time |

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

- [ ] Sticky goods bid places bid from dock  
- [ ] iOS max bid ships  
- [ ] Docs no longer claim AES-GCM / prod fail-open flags  
- [ ] Command palette can jump to live market entities  
- [ ] Positions surface exists  
- [ ] Plan statuses updated Done  

Commercial / production SOTA remains Founder + pilot (Wave F).
