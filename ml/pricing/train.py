#!/usr/bin/env python3
"""
NoMarkup Pricing Model Training (synthetic + export).

Produces a small regression model predicting "fair" cleared price (log space)
from category, geo tier, trust, volume signals, etc. Exports ONNX for Rust engines.

This is the scaffolding that turns the deterministic fair_price engine inputs
into a learned model. In production, train on real cleared-auction windows.

Usage:
  python -m ml.pricing.train --synthetic --export onnx --out /tmp/price.onnx
"""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib

try:
    import onnx
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType
    HAS_ONNX = True
except Exception:
    HAS_ONNX = False


def generate_synthetic(n: int = 8000, seed: int = 42) -> pd.DataFrame:
    """Generate realistic synthetic cleared transactions matching platform signals."""
    rng = np.random.default_rng(seed)
    categories = ["plumbing", "electrical", "cleaning", "handyman", "landscaping", "hvac"]
    trust_tiers = [0, 1, 2, 3, 4]  # 0=low ... 4=elite

    rows = []
    for _ in range(n):
        cat = rng.choice(categories)
        trust = int(rng.choice(trust_tiers, p=[0.1, 0.2, 0.3, 0.3, 0.1]))
        # base price by category (log cents)
        base = {
            "plumbing": 8.0, "electrical": 8.3, "cleaning": 6.5,
            "handyman": 7.2, "landscaping": 7.5, "hvac": 9.0
        }[cat]
        # volume and recency effects
        seller_vol = rng.lognormal(3.0, 0.8)  # jobs in window
        recency = rng.uniform(0.5, 30)  # days since similar close

        # simulate market clearing
        log_price = (
            base
            + 0.12 * trust
            + 0.04 * np.log1p(seller_vol)
            - 0.01 * recency
            + rng.normal(0, 0.18)
        )
        price_cents = int(np.exp(log_price).round())
        price_cents = max(1500, min(price_cents, 250_000))

        rows.append({
            "category": cat,
            "trust_tier": trust,
            "seller_volume_90d": int(seller_vol),
            "days_since_similar": recency,
            "cleared_price_cents": price_cents,
            "bid_count": max(1, int(rng.normal(4 + trust, 2))),
            "is_weekend": int(rng.random() < 0.28),
        })
    return pd.DataFrame(rows)


def featurize(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    X = pd.get_dummies(df[["category", "trust_tier", "seller_volume_90d", "days_since_similar", "bid_count", "is_weekend"]], drop_first=True)
    y = np.log(df["cleared_price_cents"].astype(float))
    return X, y


def train_and_export(synthetic: bool = True, export_onnx: bool = False, out_path: str | None = None):
    if synthetic:
        df = generate_synthetic()
    else:
        # In real use: load from analytics export (parquet/CSV of cleared txns)
        raise NotImplementedError("real data path not wired; use --synthetic for scaffolding")

    X, y = featurize(df)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)

    pipe = Pipeline([
        ("scale", StandardScaler(with_mean=False)),
        ("model", GradientBoostingRegressor(n_estimators=120, max_depth=4, learning_rate=0.08, random_state=42)),
    ])
    pipe.fit(Xtr, ytr)

    pred = pipe.predict(Xte)
    mae_log = mean_absolute_error(yte, pred)
    mae_cents = np.mean(np.abs(np.exp(yte) - np.exp(pred)))

    print(f"Trained on {len(Xtr)} rows. Test MAE (log): {mae_log:.3f} | cents: ${mae_cents/100:.2f}")

    meta = {
        "model_version": "price-gb-v0.1.0",
        "trained_at": datetime.utcnow().isoformat() + "Z",
        "features": list(X.columns),
        "synthetic": synthetic,
        "n_train": len(Xtr),
        "mae_log": float(mae_log),
        "mae_cents_mean": float(mae_cents),
    }

    if out_path:
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        # Always save sklearn pipeline for reproducibility
        joblib.dump({"pipe": pipe, "meta": meta}, out.with_suffix(".joblib"))

        if export_onnx and HAS_ONNX:
            initial_type = [("float_input", FloatTensorType([None, X.shape[1]]))]
            onnx_model = convert_sklearn(pipe, initial_types=initial_type, target_opset=13)
            # attach metadata
            onnx_model.doc_string = json.dumps(meta)
            onnx.save_model(onnx_model, str(out))
            print(f"Exported ONNX to {out}")
        elif export_onnx:
            print("ONNX export skipped (skl2onnx / onnx not installed)")
        print(f"Also saved joblib to {out.with_suffix('.joblib')}")

    return pipe, meta


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--synthetic", action="store_true", default=True)
    p.add_argument("--export", choices=["onnx", "joblib", "both"], default="onnx")
    p.add_argument("--out", type=str, default="/tmp/nomarkup-price-v0.onnx")
    args = p.parse_args()

    export_onnx = args.export in ("onnx", "both")
    train_and_export(synthetic=args.synthetic, export_onnx=export_onnx, out_path=args.out)
