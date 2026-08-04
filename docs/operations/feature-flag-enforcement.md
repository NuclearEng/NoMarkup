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

Money/regulated keys are **binary-only** (no sticky % partial rollout).

## UI-only (flag map hides chrome; API may remain open)

Examples (not exhaustive): `fair_price_index`, `smart_matching`, `provider_business_os`, `lead_gen` (confirm against seed + router). **Do not claim “flag off = API off”** for these until `RequireFlag` is wired.

## Ops

- Seed flags in migrations / admin `/admin/flags`.
- Production missing row on a **RequireFlag** route → 503 by design.
