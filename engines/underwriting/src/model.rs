//! Deterministic working-capital underwriting model.
//!
//! An additive logistic scorecard (explainable, regulator-friendly) + cash-flow
//! exposure sizing + risk-banded factor pricing. Pure function of [`Features`];
//! no clock, no RNG, no I/O — the caller passes `as_of_unix` and pre-windowed,
//! escrow-SETTLED inputs, so a decision is reproducible and auditable.
//!
//! Security: the borrowing base is escrow-RELEASED earnings, so fabricating $1
//! of limit costs ~$1 of real platform fees and leaves a counterparty-paired,
//! fraud-scored trail. The engine enforces hard invariants regardless of inputs
//! (see the proptest suite in `tests/`). Each decision carries a SHA-256
//! `decision_hash` over (canonical features || decision || model version).

use sha2::{Digest, Sha256};

/// Bump on any change to weights/gates/sizing so a stored `decision_hash` is
/// tied to the exact model that produced it.
pub const MODEL_VERSION: &str = "uw-v1.0.0";

// ── Caps & floors (cents) ──────────────────────────────────────────────────
const CAP_ABS_CENTS: i64 = 2_500_000; // $25,000 absolute platform maximum
const MIN_OFFER_CENTS: i64 = 25_000; // < $250 → no offer (ops/risk floor)
const ACTIVITY_FLOOR_CENTS: i64 = 50_000; // < $500 trailing-year → ineligible
const REVENUE_CAP_PCT: i64 = 35; // ≤ 35% of trailing-12mo earnings

// ── Approval gates ─────────────────────────────────────────────────────────
const PD_CEILING: f64 = 0.35;
const FRAUD_GATE: f64 = 0.5; // trust_fraud below this → ineligible
const DISPUTE_GATE: f64 = 0.10; // dispute_rate_90d above this → ineligible
const MIN_ACTIVE_MONTHS: i32 = 3;

// ── Pricing band ───────────────────────────────────────────────────────────
const FEE_MIN_BPS: i32 = 600; // 6%  (factor 1.06)
const FEE_MAX_BPS: i32 = 1800; // 18% (factor 1.18)

// ── Scorecard weights (signed log-odds contributions) ──────────────────────
const W_REPAY: f64 = 1.30;
const W_DISPUTE: f64 = 1.20;
const W_FRAUD: f64 = 1.50;
const W_TRUST: f64 = 1.00;
const W_FEEDBACK: f64 = 0.50;
const W_VELOCITY: f64 = 0.60;
const W_CONSISTENCY: f64 = 0.50;
const W_TENURE: f64 = 0.40;
const W_THINFILE: f64 = 0.40;
const BIAS: f64 = -1.20;

/// Provider features — all gathered server-side from un-forgeable, escrow-settled
/// data. Money is integer cents; rates are 0.0..=1.0.
#[derive(Debug, Clone, PartialEq)]
pub struct Features {
    pub provider_id: String,
    pub trust_overall: f64,
    pub trust_feedback: f64,
    pub trust_fraud: f64,
    pub trust_tier: String,
    pub trailing_30d_earnings_cents: i64,
    pub trailing_90d_earnings_cents: i64,
    pub trailing_365d_earnings_cents: i64,
    pub completed_jobs_90d: i32,
    pub active_months: i32,
    pub on_time_repayment_rate: f64,
    pub prior_advances_count: i32,
    pub dispute_rate_90d: f64,
    pub account_tenure_days: i32,
    pub outstanding_advance_cents: i64,
    pub as_of_unix: i64,
}

/// The engine's own risk band (distinct from the trust tier).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnderwritingTier {
    Ineligible,
    Starter,
    Standard,
    Premium,
    Elite,
}

/// One signed, exact contribution to the log-odds `z` (fair-lending reason).
#[derive(Debug, Clone, PartialEq)]
pub struct Reason {
    pub code: &'static str,
    pub label: &'static str,
    pub contribution: f64,
}

/// The underwriting decision.
#[derive(Debug, Clone, PartialEq)]
pub struct Decision {
    pub provider_id: String,
    pub approved: bool,
    pub tier: UnderwritingTier,
    pub max_credit_cents: i64,
    pub available_credit_cents: i64,
    pub fee_bps: i32,
    pub factor_rate: f64,
    pub holdback_pct: i32,
    pub risk_score: f64,
    pub binding_gate: String,
    pub binding_cap: String,
    pub reasons: Vec<Reason>,
    pub decision_hash: String,
    pub model_version: &'static str,
}

#[inline]
fn clampf(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

/// Map a normalized trust tier string to a sizing multiplier. Unknown/empty →
/// 0.0 (fail closed). `new`/`under_review` are also caught by the gate.
fn tier_multiplier(tier: &str) -> f64 {
    match tier {
        "top_rated" => 1.00,
        "trusted" => 0.85,
        "rising" => 0.55,
        _ => 0.0, // new, under_review, unknown
    }
}

fn tier_is_gated(tier: &str) -> bool {
    matches!(tier, "new" | "under_review") || tier_multiplier(tier) == 0.0
}

/// Round a non-negative cents-valued f64 to the nearest whole cent (half away
/// from zero), saturating into i64.
fn round_cents(x: f64) -> i64 {
    let r = x.round();
    if r.is_finite() {
        clampf(r, 0.0, i64::MAX as f64) as i64
    } else {
        0
    }
}

/// Underwrite a provider. Deterministic, pure, sub-millisecond.
#[must_use]
// One linear pass: normalize -> score -> gate -> size -> price. Splitting the
// scorecard across helpers would hurt auditability of the regulated decision flow.
#[allow(clippy::too_many_lines)]
pub fn underwrite(f: &Features) -> Decision {
    // ── Defensive normalization of inputs to valid ranges (fail-safe; the
    //    caller is server-authoritative but we never trust an out-of-range
    //    value to produce an out-of-range decision). ──────────────────────
    let trust_overall = clampf(f.trust_overall, 0.0, 1.0);
    let trust_feedback = clampf(f.trust_feedback, 0.0, 1.0);
    let trust_fraud = clampf(f.trust_fraud, 0.0, 1.0);
    let dispute = clampf(f.dispute_rate_90d, 0.0, 1.0);
    let tenure_days = f.account_tenure_days.max(0);
    let active_months = f.active_months.clamp(0, 24);
    let prior = f.prior_advances_count.max(0);
    // Thin-file: with no prior advances the supplied repayment rate is
    // meaningless, so the engine itself substitutes the neutral 0.5 prior — a
    // caller cannot pass a flattering (or punishing) rate for a first-time
    // borrower.
    let on_time = if prior == 0 {
        0.5
    } else {
        clampf(f.on_time_repayment_rate, 0.0, 1.0)
    };
    let t30 = f.trailing_30d_earnings_cents.max(0);
    let t90 = f.trailing_90d_earnings_cents.max(0);
    let t365 = f.trailing_365d_earnings_cents.max(0);
    let outstanding = f.outstanding_advance_cents.max(0);

    // ── Derived: earnings velocity (recent month vs trailing-year monthly). ──
    let monthly_avg = (t365 as f64 / 12.0).max(1.0);
    let velocity_ratio = clampf(t30 as f64 / monthly_avg, 0.0, 3.0);

    // ── Scorecard: signed risk contributions in [-1, +1] (+ raises risk). ────
    let n_trust = (0.5 - trust_overall) * 2.0;
    let n_feedback = (0.5 - trust_feedback) * 2.0;
    let n_fraud = 1.0 - trust_fraud;
    let n_repay = (0.5 - on_time) * 2.0;
    let n_dispute = clampf(dispute * 5.0, 0.0, 1.0);
    let n_tenure = clampf((180.0 - f64::from(tenure_days)) / 180.0, 0.0, 1.0);
    let n_thinfile = clampf((5.0 - f64::from(prior)) / 5.0, 0.0, 1.0);
    let n_velocity = clampf(1.0 - velocity_ratio, -1.0, 1.0);
    let n_consistency = clampf((6.0 - f64::from(active_months)) / 6.0, 0.0, 1.0);

    // Weighted contributions (kept for the explainability breakdown).
    let c_repay = W_REPAY * n_repay;
    let c_dispute = W_DISPUTE * n_dispute;
    let c_fraud = W_FRAUD * n_fraud;
    let c_trust = W_TRUST * n_trust;
    let c_feedback = W_FEEDBACK * n_feedback;
    let c_velocity = W_VELOCITY * n_velocity;
    let c_consistency = W_CONSISTENCY * n_consistency;
    let c_tenure = W_TENURE * n_tenure;
    let c_thinfile = W_THINFILE * n_thinfile;

    let z = (BIAS
        + c_repay
        + c_dispute
        + c_fraud
        + c_trust
        + c_feedback
        + c_velocity
        + c_consistency
        + c_tenure
        + c_thinfile)
        .clamp(-8.0, 8.0);
    let pd = 1.0 / (1.0 + (-z).exp());
    let pd = clampf(pd, 0.0, 1.0);

    // Reasons sorted by |contribution| desc — the ECOA "principal reasons".
    let mut reasons = vec![
        Reason {
            code: "REPAYMENT",
            label: "On-time repayment history",
            contribution: c_repay,
        },
        Reason {
            code: "DISPUTE_RATE",
            label: "Recent dispute rate",
            contribution: c_dispute,
        },
        Reason {
            code: "FRAUD",
            label: "Fraud signal",
            contribution: c_fraud,
        },
        Reason {
            code: "TRUST",
            label: "Overall trust score",
            contribution: c_trust,
        },
        Reason {
            code: "FEEDBACK",
            label: "Customer feedback",
            contribution: c_feedback,
        },
        Reason {
            code: "VELOCITY",
            label: "Earnings trajectory",
            contribution: c_velocity,
        },
        Reason {
            code: "CONSISTENCY",
            label: "Months of consistent activity",
            contribution: c_consistency,
        },
        Reason {
            code: "TENURE",
            label: "Account age",
            contribution: c_tenure,
        },
        Reason {
            code: "THIN_FILE",
            label: "Advance track record",
            contribution: c_thinfile,
        },
    ];
    // Deterministic order: |contribution| desc, then code asc to break ties.
    reasons.sort_by(|a, b| {
        b.contribution
            .abs()
            .partial_cmp(&a.contribution.abs())
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.code.cmp(b.code))
    });

    // ── Approval gates (first failing gate is binding). ──────────────────────
    let binding_gate: Option<(&str, String)> = if tier_is_gated(&f.trust_tier) {
        Some((
            "TIER",
            format!("Account tier not yet eligible ({})", f.trust_tier),
        ))
    } else if trust_fraud < FRAUD_GATE {
        Some(("FRAUD", "Open fraud signal on the account".to_string()))
    } else if dispute > DISPUTE_GATE {
        Some((
            "DISPUTE",
            format!("Recent dispute rate too high ({:.0}%)", dispute * 100.0),
        ))
    } else if active_months < MIN_ACTIVE_MONTHS {
        Some((
            "ACTIVITY",
            "Needs at least 3 months of completed work".to_string(),
        ))
    } else if t365 < ACTIVITY_FLOOR_CENTS {
        Some((
            "ACTIVITY",
            "Trailing-year earnings below the $500 minimum".to_string(),
        ))
    } else if pd > PD_CEILING {
        Some((
            "RISK",
            "Risk score above the eligibility ceiling".to_string(),
        ))
    } else {
        None
    };

    let model_version = MODEL_VERSION;

    if let Some((code, msg)) = binding_gate {
        let decision = Decision {
            provider_id: f.provider_id.clone(),
            approved: false,
            tier: UnderwritingTier::Ineligible,
            max_credit_cents: 0,
            available_credit_cents: 0,
            fee_bps: 0,
            factor_rate: 0.0,
            holdback_pct: 0,
            risk_score: pd,
            binding_gate: format!("{code}: {msg}"),
            binding_cap: String::new(),
            reasons,
            decision_hash: String::new(),
            model_version,
        };
        return finalize(decision, f, pd);
    }

    // ── Limit sizing (cash-flow exposure). ───────────────────────────────────
    let monthly_base = (t90 as f64 / 3.0).max(t30 as f64);
    let risk_mult = clampf(2.1 - 6.0 * pd, 0.0, 2.0);
    let tier_mult = tier_multiplier(&f.trust_tier);
    let raw_cents = monthly_base * risk_mult * tier_mult;

    let cap_revenue = (t365.saturating_mul(REVENUE_CAP_PCT)) / 100;
    let cap_abs = CAP_ABS_CENTS;

    let mut limit = round_cents(raw_cents).min(cap_revenue).min(cap_abs).max(0);

    // Which cap (if any) bound the offer — transparency for "how to grow it".
    let binding_cap = if limit == cap_abs {
        "absolute_max"
    } else if limit == cap_revenue {
        "revenue_35pct"
    } else {
        "risk_multiple"
    };

    // Min-offer floor: a sub-$250 line isn't worth the risk/ops.
    if limit < MIN_OFFER_CENTS {
        limit = 0;
    }

    let available = (limit - outstanding).max(0);

    // ── Pricing (risk-banded factor rate). ───────────────────────────────────
    let fee_span = f64::from(FEE_MAX_BPS - FEE_MIN_BPS);
    let fee_bps = (f64::from(FEE_MIN_BPS) + fee_span * (pd / PD_CEILING)).round();
    let fee_bps = (fee_bps as i32).clamp(FEE_MIN_BPS, FEE_MAX_BPS);
    let factor_rate = 1.0 + f64::from(fee_bps) / 10_000.0;
    let holdback_pct = (8.0 + (20.0 * pd).round()).clamp(8.0, 20.0) as i32;

    let tier = if limit == 0 {
        UnderwritingTier::Ineligible
    } else {
        underwriting_tier(pd)
    };

    let decision = Decision {
        provider_id: f.provider_id.clone(),
        approved: limit > 0,
        tier,
        max_credit_cents: limit,
        available_credit_cents: available,
        fee_bps: if limit > 0 { fee_bps } else { 0 },
        factor_rate: if limit > 0 { factor_rate } else { 0.0 },
        holdback_pct: if limit > 0 { holdback_pct } else { 0 },
        risk_score: pd,
        binding_gate: String::new(),
        binding_cap: if limit > 0 {
            binding_cap.to_string()
        } else {
            String::new()
        },
        reasons,
        decision_hash: String::new(),
        model_version,
    };
    finalize(decision, f, pd)
}

fn underwriting_tier(pd: f64) -> UnderwritingTier {
    if pd <= 0.05 {
        UnderwritingTier::Elite
    } else if pd <= 0.12 {
        UnderwritingTier::Premium
    } else if pd <= 0.22 {
        UnderwritingTier::Standard
    } else {
        UnderwritingTier::Starter
    }
}

/// Compute the tamper-evidence hash over canonical (features || decision ||
/// version) and attach it.
fn finalize(mut d: Decision, f: &Features, _pd: f64) -> Decision {
    let mut hasher = Sha256::new();
    // Canonical, order-fixed serialization of the inputs that determine the
    // decision, then the decision outputs, then the model version.
    let canonical = format!(
        "v={ver}|pid={pid}|to={to:.6}|tf={tf:.6}|fr={fr:.6}|tier={tier}|t30={t30}|t90={t90}|t365={t365}|j90={j90}|am={am}|otr={otr:.6}|pa={pa}|dr={dr:.6}|ten={ten}|out={out}|as_of={asof}|=>|appr={appr}|max={max}|avail={avail}|fee={fee}|hb={hb}|rs={rs:.9}|cap={cap}|gate={gate}",
        ver = d.model_version,
        pid = f.provider_id,
        to = f.trust_overall,
        tf = f.trust_feedback,
        fr = f.trust_fraud,
        tier = f.trust_tier,
        t30 = f.trailing_30d_earnings_cents,
        t90 = f.trailing_90d_earnings_cents,
        t365 = f.trailing_365d_earnings_cents,
        j90 = f.completed_jobs_90d,
        am = f.active_months,
        otr = f.on_time_repayment_rate,
        pa = f.prior_advances_count,
        dr = f.dispute_rate_90d,
        ten = f.account_tenure_days,
        out = f.outstanding_advance_cents,
        asof = f.as_of_unix,
        appr = d.approved,
        max = d.max_credit_cents,
        avail = d.available_credit_cents,
        fee = d.fee_bps,
        hb = d.holdback_pct,
        rs = d.risk_score,
        cap = d.binding_cap,
        gate = d.binding_gate,
    );
    hasher.update(canonical.as_bytes());
    d.decision_hash = hex::encode(hasher.finalize());
    d
}
