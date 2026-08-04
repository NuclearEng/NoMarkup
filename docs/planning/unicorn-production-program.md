# Unicorn Production Program — Bloomberg × Robinhood bar

**Date:** 2026-08-03  
**Branch:** `fix/security-audit-2026-04-23`  
**North star:** NoMarkup feels like a **market terminal** (Bloomberg density, live
data, keyboard) with **consumer delight** (Robinhood friction, green price motion,
one primary CTA). Product eng dual-rail is **100/100**; production GO is **founder-gated**.

---

## Honest status

| Bar | Status |
|-----|--------|
| Consumer dual-rail eng | **100 / 100** (scorecards 2026-08-02) |
| Full PRD eng-max | **100 / 100** (Decision-IDs absorb Phase 2–9) |
| ASC packaging eng | **100 / 100** — founder portal residual |
| **Production cloud GO** | **Blocked** — Founder-Action only |
| **Unicorn UX** | **Wave 1 shipping** (this program) |

**Do not claim:** “live in production” or “App Store submitted” without founder rows.

---

## Production GO — two columns

### Founder (blocks real GO)

1. **OPS-02** — AWS (or external) + PostGIS + Redis + S3; terraform apply or document provisioner  
2. **OPS-04** — Vault/ESO → `nomarkup-secrets` (JWT, Stripe, METRICS dual token, Google, ENCRYPTION_KEY, …)  
3. **OPS-24** — Cloudflare zone + WAF + auth cache-bypass (`docs/operations/cdn-cache-auth-bypass.md`)  
4. **DEPLOY_PROVISIONED=true** only after migrate job + secrets proven  
5. **QA-10** — branch protection requires **Security Gate**  
6. **SEC-17** — rotate historical seed/QA passwords  
7. Stripe dogfood: charge → hold → release/dispute on test keys  
8. ASC rows 1–14 if App Store is in scope (`docs/compliance/launch-board.md`)  
9. Keep regulated money flags **OFF** until **R6-LICENSES**

### Eng (shipped or optional polish — not GO blockers)

| Item | Status |
|------|--------|
| Dual-rail product + money races (tracker Open=0) | Done |
| mTLS code (default off) | Done — arm only after HTTP probes + certs |
| Unicorn Wave 1 (mono money, ⌘K, dock bid, sticky listing CTA, JobCard urgency) | **This session** |
| Bid-bond release/cron residual | Optional money polish (handoff C11) |
| Migration sequence CI lint | Optional ops hygiene |

---

## Unicorn UX waves

### Wave 1 — shipped (code)

| # | Change | Why |
|---|--------|-----|
| 1 | `MonoPrice` + `AnimatedPrice` mono stack | Bloomberg identity = mono figures |
| 2 | Global **⌘K / Ctrl+K** command palette | Terminal keyboard jump |
| 3 | `BidForm variant="dock"` on live job sticky | Robinhood one-primary CTA |
| 4 | Listing detail sticky mobile bid bar + `AnimatedPrice` hero | RH mobile friction |
| 5 | JobCard scoreboard urgency + mono prices | Parity with goods ScoreboardCard |
| 6 | Order book + ScoreboardCard mono prices | Dense market read |

### Wave 2 — shipped (code) 2026-08-03

| # | Change | Evidence |
|---|--------|----------|
| 1 | Terminal truth: job description/title/category, snipe count, real `jobId` | `WidgetProps`, job-details / price-hero / order-book widgets |
| 2 | Velocity widget registered | `widget-registry.ts` |
| 3 | Terminal hotkeys live/spectate/replay | `useTerminalHotkeys.ts` |
| 4 | Sealed job sidebar always shows ticker + mono prices | `JobDetailClient.tsx` |
| 5 | Bid-bond stranded sweep cron | `bid_bond_sweep_cron.go` + `SweepStrandedBidBonds` |
| 6 | Migration sequence CI lint | `scripts/check-migration-sequence.sh` + CI job |
| 7 | Engine k8s probes → HTTP `/healthz` on metrics (pre-mTLS) | all six engine Deployments |
| 8 | RSC `serverFetch` + trace headers | `web/src/lib/server-fetch.ts` on public reads |

### Wave 3 — founder / live proof (not eng-closable)

- Staging cluster + `DEPLOY_PROVISIONED` + Vault/ESO + Cloudflare
- Stripe live dogfood + k6/`CDN_TTFB` URLs
- Field RUM / Lighthouse North Star ratchet
- Goods full TerminalGrid on listing spectate (product polish residual, not GO-block)
- Mobile terminal 2-up layout (polish residual)

---

## Do-not-break (from audit)

- Order book new-row flash + lowest pulse  
- LIVE badge only when socket open (never fake)  
- RSC `initialData` seeds (no skeleton flash)  
- Money flags binary + fail-closed in production  
- Off-session charge **OFF** until ToS (ADR-0001)

---

## Verification

```bash
cd web && npm test -- --run tests/unit/components/ui/mono-price.test.tsx \
  tests/unit/components/command/command-palette.test.tsx
```

Manual: open `/`, press ⌘K; open a live job as provider → dock form; open listing on mobile width → sticky bid bar.

---

## Reproducibility

Wave 1 lives on branch `fix/security-audit-2026-04-23`. Production GO remains
**CONDITIONAL** until founder columns complete. UX bar is iterative — Wave 1 is
the densest 1-day lift without inventing new product domains.
