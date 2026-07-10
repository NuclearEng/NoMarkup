# NoMarkup ML Training (Data Moat)

This directory contains the **training pipelines** that turn proprietary transaction data into models for:

- Fraud risk (classifier on behavioral + fingerprint signals)
- Fair / predicted price (regression or quantile residual model)
- Future: demand forecasting, personalized ranking, churn

**Production inference lives in the Rust engines** (via `ort` / ONNX). Training is Python-only and runs offline (exports .onnx artifacts that are checked into the engine image or served via model registry).

See gap-closure-plan.md Phase 1 and CLAUDE.md (ML reserved for v2 in current builds; scaffolding + deterministic fallback now landed).

## Quick Start (synthetic)

```bash
cd ml
pip install -r requirements.txt
python -m pricing.train --synthetic --export onnx --out ../engines/pricing/models/price_v0.onnx
python -m fraud.train --synthetic --export onnx --out ../engines/fraud/models/fraud_v0.onnx
```

The synthetic generator uses realistic distributions matching the platform (cleared auction prices, trust tiers, bid patterns, repayment behavior from escrow signals).

## Layout
- `pricing/` — fair price / suggested price model
- `fraud/` — risk classifier
- `common/` (future) — shared feature extractors, ONNX helpers
- `notebooks/` (future) — EDA + model cards

## Data Contract (when using real exports)
Input features are derived **only from settled, non-PII** transaction graphs:
- Cleared price, category, geo (zip/market), condition, trust_tier at time of close, bid_count, time_to_close, seller_volume_90d, buyer_dispute_rate, etc.
- Never raw PII, emails, exact addresses.

Exports for training should be produced by an admin job or analytics pipeline (anonymized aggregate + windowed stats).

## Model Versioning & Reproducibility
- Every exported .onnx carries `model_version` metadata.
- Training script records git sha + hyperparams + data window.
- Engines load with version check and fall back to heuristic on mismatch or load failure (fail closed for safety).

## Integration with Engines
See `engines/pricing/src/model.rs` and `engines/fraud/src/...` for the deterministic side.
The Rust side will (behind optional `ort` cfg feature, off by default per policy):
```rust
if let Some(model) = load_onnx(...) {
    model.predict(features)
} else {
    heuristic::fair_price(...)
}
```

## Acceptance (for gap closure)
- `python -m pricing.train --synthetic` succeeds and writes a loadable .onnx
- A small Rust test (when wired) can load the toy model and get different-from-heuristic output on edge cases
- Docs + CLI are self-contained (no external secrets)

Run `make ml-train-synthetic` (to be added to root Makefile) for CI smoke.
