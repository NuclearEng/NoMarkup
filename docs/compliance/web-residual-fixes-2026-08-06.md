# Web residual fixes — 2026-08-06

Closeout for eng-closeable residuals from `docs/compliance/web-full-persona-audit-2026-08-05.md` (P1 list + admin money confirms). Verified against current tree on branch `fix/security-audit-2026-04-23`.

## Verified already OK (no code change)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 1 | Payments hub promises manage methods without link | **Already fixed** | `web/src/app/(dashboard)/payments/page.tsx` — header CTA `Link` → `/settings/payment-methods`; empty state also links payment methods + “Post a Job” |
| 2 | `/me/positions` “Goods bids” → `/bids` | **Already fixed** | `web/src/app/(dashboard)/me/positions/page.tsx` — goods section header + empty CTA + row links go to `/marketplace` / `/marketplace/[id]` (service bids keep `/bids`) |
| 3 | Empty CTAs on customer contracts/payments say Browse Jobs | **Already fixed** | Contracts empty: “Post a Job” + “My Jobs”. Payments empty: “Post a Job” + “Payment methods” — no Browse Jobs |
| 4 | Admin payments custom fees look live | **Already fixed** | `admin/payments/page.tsx` `CustomFeesSection` amber banner: “UI preview only… saved to this browser, not the backend — they are not yet applied to any transaction”; steppers note “Custom · browser-only” |

## Fixed this pass

| # | Finding | Fix |
|---|---------|-----|
| 5 | Goods dispute resolve used bare `window.confirm` (money-moving) | `GoodsDisputesPanel` now opens `ActionConfirmDialog` after form validation (same pattern as service dispute detail + advances). Unit tests updated for two-step confirm. |

### Scope note on `window.confirm`

Remaining `window.confirm` in web app (non-admin money path, out of this residual list):

- `jobs/recurring/page.tsx` — End recurrence / cancel job (customer lifecycle, not admin money rails)

Admin money surfaces already on `ActionConfirmDialog`: advances, banking remove, service disputes resolve, listings/jobs/reviews/user-reports/goods-reports destructive actions, users suspend/ban.

## Residual still open (not eng-closed here)

| Item | Why open |
|------|----------|
| Custom fees backend (`platform_custom_fees` + CRUD) | Product backlog — UI is honest local-only; wiring is a feature, not a residual lie |
| Set-default payment method UI | Audit P1; separate from hub→methods link (delete-only today) |
| Dual-role chrome / orphan nav / map SEO / etc. | Broader audit P0/P1 — not in this residual checklist |

## Verify

```bash
cd web && npx vitest run tests/unit/components/admin/GoodsDisputesPanel.test.tsx
```
