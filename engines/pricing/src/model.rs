//! Fair Price Index model — log-space robust weighted estimation + empirical-
//! Bayes hierarchical shrinkage. Pure deterministic function (no clock/RNG/IO):
//! the caller passes `as_of` and a candidate transaction set; the engine buckets
//! by geo/category, robustly estimates each level, and partial-pools sparse
//! cells toward their parent so thin cells fall back gracefully instead of
//! returning nothing.
//!
//! Prices are ~log-normal, so all location math is in log space (median is
//! scale-equivariant, fences/bands symmetrize), exponentiated back at the end.

/// Bump on any change to constants/estimator so a cached estimate is tied to the
/// model that produced it.
pub const MODEL_VERSION: &str = "fpi-v1.0.0";

// ── Constants (frozen per release for determinism) ──────────────────────────
const HALF_LIFE_DAYS: f64 = 120.0; // recency decay half-life
const MAX_WINDOW_DAYS: f64 = 540.0; // hard cutoff (~4.5 half-lives)
const IQR_K: f64 = 1.5; // Tukey fence multiplier
const SHRINK_K: f64 = 8.0; // partial-pooling pseudo-count, B = n/(n+k)
const TRUST_W: [f64; 5] = [0.25, 0.5, 1.0, 1.0, 1.25]; // weight by trust tier 0..4
const Z95: f64 = 1.96;
const SE_MEDIAN_K: f64 = 1.2533; // sqrt(pi/2), median SE constant
const CONF_N_SAT: f64 = 30.0; // n at which sample-size confidence saturates
const DISP_D0: f64 = 0.35; // dispersion reference (~±42%)
const SECONDS_PER_DAY: f64 = 86_400.0;
const NUM_LEVELS: u32 = 6;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Unspecified,
    Service,
    Good,
}

/// One settled, escrow-confirmed cleared price. `parent_category_id` + `market_id`
/// are caller-supplied so the engine can bucket + fall back without a taxonomy
/// lookup.
#[derive(Clone, Debug)]
pub struct Txn {
    pub category_id: String,
    pub parent_category_id: String,
    pub market_id: String,
    pub zip: String,
    pub cleared_price_cents: i64,
    pub settled_at: i64,
    pub trust_tier: u32,
    pub instant_match: bool,
    pub condition: u32,
    pub side: Side,
}

#[derive(Clone, Debug)]
pub struct Query {
    pub category_id: String,
    pub parent_category_id: String,
    pub zip: String,
    pub market_id: String,
    pub as_of: i64,
    pub side: Side,
    pub want_instant: Option<bool>,
    pub want_condition: Option<u32>,
    pub want_trust_tier_min: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FairPrice {
    pub has_data: bool,
    pub price_cents: i64,
    pub p25_cents: i64,
    pub p75_cents: i64,
    pub ci_lo_cents: i64,
    pub ci_hi_cents: i64,
    pub n_eff: f64,
    pub confidence: f64,
    pub confidence_label: &'static str,
    pub level_used: u32,
    pub model_version: &'static str,
}

fn no_data() -> FairPrice {
    FairPrice {
        has_data: false,
        price_cents: 0,
        p25_cents: 0,
        p75_cents: 0,
        ci_lo_cents: 0,
        ci_hi_cents: 0,
        n_eff: 0.0,
        confidence: 0.0,
        confidence_label: "low",
        level_used: 0,
        model_version: MODEL_VERSION,
    }
}

/// Unweighted type-7 (linear-interpolation) quantile on an ascending-sorted
/// slice. Used for the IQR outlier fence (unweighted so a heavily-weighted
/// outlier can't drag the fence out to cover itself).
fn quantile_type7(sorted: &[f64], p: f64) -> f64 {
    match sorted.len() {
        0 => 0.0,
        1 => sorted[0],
        n => {
            let h = (n as f64 - 1.0) * p;
            let lo = h.floor() as usize;
            let hi = (lo + 1).min(n - 1);
            let frac = h - lo as f64;
            sorted[lo] + frac * (sorted[hi] - sorted[lo])
        }
    }
}

/// Weighted interpolated quantile (ClickHouse `quantileInterpolatedWeighted`
/// semantics). `pairs` ascending-sorted by value; weights > 0.
fn weighted_quantile(pairs: &[(f64, f64)], p: f64) -> f64 {
    if pairs.is_empty() {
        return 0.0;
    }
    if pairs.len() == 1 {
        return pairs[0].0;
    }
    let w_total: f64 = pairs.iter().map(|x| x.1).sum();
    if w_total <= 0.0 {
        return pairs[pairs.len() / 2].0;
    }
    let target = p * w_total;
    let mut cum = 0.0;
    for k in 0..pairs.len() {
        let prev = cum;
        cum += pairs[k].1;
        if cum >= target {
            if k == 0 {
                return pairs[0].0;
            }
            let seg = pairs[k].1;
            let frac = if seg > 0.0 {
                ((target - prev) / seg).clamp(0.0, 1.0)
            } else {
                0.0
            };
            return pairs[k - 1].0 + frac * (pairs[k].0 - pairs[k - 1].0);
        }
    }
    pairs[pairs.len() - 1].0
}

/// Robust per-cell statistics in log space.
#[derive(Clone, Debug)]
struct Cell {
    m_log: f64,
    p25_log: f64,
    p75_log: f64,
    n_eff: f64,
    mad_log: f64,
    mean_age_days: f64,
}

/// Compute a cell's robust weighted statistics, or None if it has no usable
/// transactions.
fn compute_cell(txns: &[&Txn], as_of: i64) -> Option<Cell> {
    // (y = ln(price), weight, age_days)
    let mut pts: Vec<(f64, f64, f64)> = Vec::with_capacity(txns.len());
    for t in txns {
        if t.cleared_price_cents <= 0 {
            continue;
        }
        let age = (as_of - t.settled_at) as f64 / SECONDS_PER_DAY;
        if !(0.0..=MAX_WINDOW_DAYS).contains(&age) {
            continue;
        }
        let y = (t.cleared_price_cents as f64).ln();
        let w_rec = 2f64.powf(-age / HALF_LIFE_DAYS);
        let w_trust = TRUST_W[t.trust_tier.min(4) as usize];
        let w = w_rec * w_trust;
        if w > 0.0 && y.is_finite() {
            pts.push((y, w, age));
        }
    }
    if pts.is_empty() {
        return None;
    }

    // Outlier fence (unweighted IQR in log space) — only when n >= 4.
    if pts.len() >= 4 {
        let mut ys: Vec<f64> = pts.iter().map(|p| p.0).collect();
        ys.sort_by(f64::total_cmp);
        let q1 = quantile_type7(&ys, 0.25);
        let q3 = quantile_type7(&ys, 0.75);
        let iqr = q3 - q1;
        let lo = q1 - IQR_K * iqr;
        let hi = q3 + IQR_K * iqr;
        pts.retain(|p| p.0 >= lo && p.0 <= hi);
    }
    if pts.is_empty() {
        return None;
    }

    pts.sort_by(|a, b| a.0.total_cmp(&b.0));
    let pairs: Vec<(f64, f64)> = pts.iter().map(|p| (p.0, p.1)).collect();
    let sum_w: f64 = pts.iter().map(|p| p.1).sum();
    let sum_w2: f64 = pts.iter().map(|p| p.1 * p.1).sum();
    // Kish effective sample size.
    let n_eff = if sum_w2 > 0.0 {
        sum_w * sum_w / sum_w2
    } else {
        0.0
    };

    let m_log = weighted_quantile(&pairs, 0.5);
    let p25_log = weighted_quantile(&pairs, 0.25);
    let p75_log = weighted_quantile(&pairs, 0.75);

    let mut devs: Vec<f64> = pts.iter().map(|p| (p.0 - m_log).abs()).collect();
    devs.sort_by(f64::total_cmp);
    let mad_log = quantile_type7(&devs, 0.5);

    let mean_age_days = if sum_w > 0.0 {
        pts.iter().map(|p| p.1 * p.2).sum::<f64>() / sum_w
    } else {
        0.0
    };

    Some(Cell {
        m_log,
        p25_log,
        p75_log,
        n_eff,
        mad_log,
        mean_age_days,
    })
}

/// Does a transaction belong to hierarchy `level` for this query? Finest (0) →
/// coarsest (5): zip×cat, market×cat, market×parent, national×cat,
/// national×parent, national×side.
fn in_level(t: &Txn, q: &Query, level: u32) -> bool {
    match level {
        0 => !q.zip.is_empty() && t.zip == q.zip && t.category_id == q.category_id,
        1 => {
            !q.market_id.is_empty() && t.market_id == q.market_id && t.category_id == q.category_id
        }
        2 => {
            !q.market_id.is_empty()
                && !q.parent_category_id.is_empty()
                && t.market_id == q.market_id
                && t.parent_category_id == q.parent_category_id
        }
        3 => t.category_id == q.category_id,
        4 => !q.parent_category_id.is_empty() && t.parent_category_id == q.parent_category_id,
        5 => t.side == q.side,
        _ => false,
    }
}

/// Compute the fair price for a (category × geo × time) cell. Deterministic, pure.
#[must_use]
pub fn fair_price(txns: &[Txn], q: &Query) -> FairPrice {
    // 1. Covariate + window filter (preserves input order → deterministic).
    let filtered: Vec<&Txn> = txns
        .iter()
        .filter(|t| {
            t.cleared_price_cents > 0
                && q.want_instant.is_none_or(|w| t.instant_match == w)
                && q.want_condition.is_none_or(|w| t.condition == w)
                && q.want_trust_tier_min.is_none_or(|w| t.trust_tier >= w)
                && {
                    let age = (q.as_of - t.settled_at) as f64 / SECONDS_PER_DAY;
                    (0.0..=MAX_WINDOW_DAYS).contains(&age)
                }
        })
        .collect();

    if filtered.is_empty() {
        return no_data();
    }

    // Global price range of the candidate set (for the boundedness invariant).
    let min_price = filtered
        .iter()
        .map(|t| t.cleared_price_cents)
        .min()
        .unwrap_or(1);
    let max_price = filtered
        .iter()
        .map(|t| t.cleared_price_cents)
        .max()
        .unwrap_or(1);

    // 2. Compute each hierarchy level's cell.
    let cells: Vec<Option<Cell>> = (0..NUM_LEVELS)
        .map(|level| {
            let level_txns: Vec<&Txn> = filtered
                .iter()
                .copied()
                .filter(|t| in_level(t, q, level))
                .collect();
            compute_cell(&level_txns, q.as_of)
        })
        .collect();

    // Deepest non-empty level = local; nearest non-empty coarser = parent.
    let Some(local_idx) = cells.iter().position(Option::is_some) else {
        return no_data();
    };
    let local = cells[local_idx].clone().unwrap();
    let parent = cells[local_idx + 1..].iter().flatten().next().cloned();

    // 3. Shrinkage (partial pool local toward parent with the SAME weight B for
    //    median + p25 + p75, so ordering is preserved).
    let (m_log, p25_log, p75_log) = match &parent {
        Some(p) => {
            let b = local.n_eff / (local.n_eff + SHRINK_K);
            (
                b * local.m_log + (1.0 - b) * p.m_log,
                b * local.p25_log + (1.0 - b) * p.p25_log,
                b * local.p75_log + (1.0 - b) * p.p75_log,
            )
        }
        None => (local.m_log, local.p25_log, local.p75_log),
    };

    // 4. CI on the median (estimator precision, from the LOCAL cell).
    let se_log = if local.n_eff > 0.0 {
        SE_MEDIAN_K * local.mad_log / local.n_eff.sqrt()
    } else {
        0.0
    };
    let ci_lo_log = m_log - Z95 * se_log;
    let ci_hi_log = m_log + Z95 * se_log;

    // 5. Confidence (size × dispersion × recency) from LOCAL evidence only.
    let c_n = 1.0 - (-local.n_eff / CONF_N_SAT).exp();
    let c_disp = 1.0 / (1.0 + local.mad_log / DISP_D0);
    let c_rec = 2f64.powf(-local.mean_age_days / HALF_LIFE_DAYS);
    let confidence = (c_n * c_disp * c_rec).clamp(0.0, 1.0);
    let confidence_label = if confidence >= 0.66 {
        "high"
    } else if confidence >= 0.33 {
        "medium"
    } else {
        "low"
    };

    // Widen the presented band toward the CI proportionally to (1 − confidence)
    // — never narrows (min/max guards), so uncertainty is always visible.
    let p25_w_log = (p25_log + (1.0 - confidence) * (ci_lo_log - p25_log)).min(p25_log);
    let p75_w_log = (p75_log + (1.0 - confidence) * (ci_hi_log - p75_log)).max(p75_log);

    // 6. Exponentiate + round to cents; clamp + order so the invariants hold
    //    exactly post-rounding.
    let to_cents = |log_v: f64| -> i64 {
        if log_v.is_finite() {
            log_v.exp().round().clamp(1.0, i64::MAX as f64) as i64
        } else {
            1
        }
    };
    let mut price = to_cents(m_log).clamp(min_price, max_price);
    if price < 1 {
        price = 1;
    }
    let p25c = to_cents(p25_w_log).min(price);
    let p75c = to_cents(p75_w_log).max(price);
    let ci_lo = to_cents(ci_lo_log).min(price);
    let ci_hi = to_cents(ci_hi_log).max(price);

    FairPrice {
        has_data: true,
        price_cents: price,
        p25_cents: p25c,
        p75_cents: p75c,
        ci_lo_cents: ci_lo,
        ci_hi_cents: ci_hi,
        n_eff: local.n_eff,
        confidence,
        confidence_label,
        level_used: local_idx as u32,
        model_version: MODEL_VERSION,
    }
}
