#!/usr/bin/env python3
"""
NoMarkup Fraud Classifier Training (synthetic scaffolding).

Simple GradientBoosting binary classifier on behavioral + fingerprint signals.
Exports ONNX for optional ort path in engines/fraud.

Run:
  python -m ml.fraud.train --synthetic --export onnx --out /tmp/fraud_v0.onnx
"""

import argparse
from datetime import datetime
from pathlib import Path
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib

try:
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType
    import onnx
    HAS_ONNX = True
except Exception:
    HAS_ONNX = False


def generate_synthetic_fraud(n: int = 6000, seed: int = 123):
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        entropy = rng.normal(180, 60)
        velocity = rng.exponential(2.5)
        geo_mismatch = rng.choice([0, 1], p=[0.9, 0.1])
        plugin_count = rng.integers(3, 18)
        font_count = rng.integers(40, 280)
        is_headless = int(rng.random() < 0.04 or entropy < 40)
        label = 1 if (is_headless or (velocity > 9 and geo_mismatch)) else 0

        rows.append({
            "fingerprint_entropy": max(5, entropy),
            "bids_last_5m": min(20, int(velocity)),
            "geo_mismatch": geo_mismatch,
            "plugin_count": plugin_count,
            "font_count": font_count,
            "hour_of_day": rng.integers(0, 24),
            "is_headless_like": is_headless,
            "is_fraud": label,
        })
    return pd.DataFrame(rows)


def train_and_export(synthetic=True, export_onnx=False, out_path=None):
    if synthetic:
        df = generate_synthetic_fraud()
    else:
        raise NotImplementedError("use --synthetic")

    y = df["is_fraud"]
    X = df.drop(columns=["is_fraud"])

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, stratify=y, random_state=7)

    pipe = Pipeline([
        ("scale", StandardScaler()),
        ("clf", GradientBoostingClassifier(n_estimators=80, max_depth=3, learning_rate=0.1, random_state=7)),
    ])
    pipe.fit(Xtr, ytr)
    proba = pipe.predict_proba(Xte)[:, 1]
    auc = roc_auc_score(yte, proba)
    print(f"Fraud model AUC: {auc:.3f} on {len(Xte)} holdout")

    meta = {
        "model_version": "fraud-gb-v0.1.0",
        "trained_at": datetime.utcnow().isoformat() + "Z",
        "features": list(X.columns),
        "synthetic": synthetic,
        "auc": float(auc),
    }

    if out_path:
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"pipe": pipe, "meta": meta}, out.with_suffix(".joblib"))
        if export_onnx and HAS_ONNX:
            initial = [("float_input", FloatTensorType([None, X.shape[1]]))]
            onnx_m = convert_sklearn(pipe, initial_types=initial, target_opset=13)
            onnx_m.doc_string = json.dumps(meta)
            onnx.save_model(onnx_m, str(out))
            print(f"ONNX exported: {out}")
        print(f"Joblib: {out.with_suffix('.joblib')}")

    return pipe, meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--synthetic", action="store_true", default=True)
    ap.add_argument("--export", choices=["onnx", "joblib", "both"], default="onnx")
    ap.add_argument("--out", default="/tmp/nomarkup-fraud-v0.onnx")
    args = ap.parse_args()
    train_and_export(args.synthetic, args.export in ("onnx", "both"), args.out)
