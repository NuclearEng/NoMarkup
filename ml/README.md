# NoMarkup ML Training (offline / not production)

This directory holds **offline training experiments** that may eventually turn proprietary
transaction data into models for:

- Fraud risk (classifier on behavioral + fingerprint signals)
- Fair / predicted price (regression or quantile residual model)
- Future: demand forecasting, personalized ranking, churn

## Production path (current builds)

**Production inference does NOT use ONNX / `ort` today.** Fraud v1 and pricing are
**deterministic heuristics** in the Rust engines. `ort` is an optional Cargo feature
placeholder reserved for a future v2 path (see CLAUDE.md §2 / PLAN §6.1). Do not treat
anything under `ml/` as a live serving dependency.

Engines fall back to heuristics by design:

- `engines/pricing` — pure numeric fair-price kernel (`model::fair_price`)
- `engines/fraud` — deterministic signal scoring
- Optional `ort` feature flags exist but are **off by default** and not wired for prod

## Quick Start (synthetic, local only)

```bash
cd ml
pip install -r requirements.txt
# Training scripts may not all be fully wired — synthetic export is experimental.
python -m pricing.train --synthetic --export onnx --out ../engines/pricing/models/price_v0.onnx
python -m fraud.train --synthetic --export onnx --out ../engines/fraud/models/fraud_v0.onnx
```

## Layout
- `pricing/` — fair price / suggested price training experiments
- `fraud/` — risk classifier training experiments
- `common/` (future) — shared feature extractors, ONNX helpers
- `notebooks/` (future) — EDA + model cards

## Data Contract (when using real exports)
Input features are derived **only from settled, non-PII** transaction graphs:
- Cleared price, category, geo (zip/market), condition, trust_tier at time of close, bid_count, time_to_close, seller_volume_90d, buyer_dispute_rate, etc.
- Never raw PII, emails, exact addresses.

## Future ONNX path (roadmap only)
If/when a learned model ships:

1. Export `.onnx` with `model_version` metadata
2. Enable engine `ort` feature and load with version check
3. Fall back to heuristic on mismatch or load failure (fail closed for safety)

```rust
// Pseudocode — not the production path today
if let Some(model) = load_onnx(...) {
    model.predict(features)
} else {
    heuristic::fair_price(...)
}
```

## Acceptance (gap closure / future)
- Synthetic train succeeds and writes a loadable `.onnx`
- A Rust test (when wired) can load the toy model and differ from heuristic on edge cases
- Docs + CLI remain self-contained (no external secrets)
- CLAUDE / architecture claims stay honest: heuristics in prod until ort is on by default

See `docs/planning/gap-closure-plan.md` and tracker **ARC-05** / **ARC-12**.
