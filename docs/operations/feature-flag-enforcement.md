# Feature flag enforcement inventory

**Truth:** Production `RequireFlag` **fail-closed** (SEC-01). Non-production fails open on missing rows only. Explicit `enabled=false` always → 503.

## API-enforced (`RequireFlag` on gateway routes)

| Flag key | Surface (examples) |
|----------|-------------------|
| `passkeys` | Passkey routes |
| `live_auction` | Live auction WS / events |
| `spectator_mode` | Spectate / replay |
| `legal_services` | Legal vertical browse + intake |
| `per_job_insurance` | Insurance quotes / purchase |
| `insurance_competition` | Insurer competition admin + quotes |
| `working_capital` | Advances request/admin |
| `nomarkup_guarantee` | Guarantee claims |
| `instant_payout` | Instant payout |
| `customer_bnpl` | BNPL installments |
| `background_checks` | Checkr scaffold POST |
| `marketplace_offers` | Best-offer create/list/update (seeded migration **122**) |
| `provider_business_os` | Expenses, tax forms, tax estimate, quote templates |

Money/regulated keys are **binary-only** (no sticky % partial rollout).

## UI-only / open API residual

| Key | Notes |
|-----|--------|
| `fair_price_index` | Public pricing/fair-price endpoints stay open (landing ticker depends on them; default seed false would 503 catalog if gated) |
| `smart_matching` | No dedicated route group yet |
| `lead_gen` | Dual-gate on fee-config only — do not gate core payments |

**Do not claim “flag off = API off”** for residual rows.

## Ops

- Seed flags in migrations / admin `/admin/flags`.
- Production missing row on a **RequireFlag** route → 503 by design.
