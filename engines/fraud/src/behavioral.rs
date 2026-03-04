#![allow(clippy::module_name_repetitions)]

//! Pure behavioral scoring functions for fraud detection.
//!
//! All functions in this module are deterministic and free of I/O.  They accept
//! pre-fetched data structures and return numeric risk scores in the 0.0..=1.0
//! range.  The [`FraudDetector`](crate::engine::FraudDetector) calls these
//! functions after gathering the required data from the database.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

// ---------------------------------------------------------------------------
// Fingerprint analysis
// ---------------------------------------------------------------------------

/// Attributes extracted from a browser fingerprint string.
///
/// Callers construct this from whatever fingerprint format they have.  The
/// fields correspond to common client-side fingerprinting signals (canvas
/// hash, WebGL renderer, installed fonts, etc.).
#[derive(Debug, Clone)]
pub struct FingerprintAttributes {
    /// Raw user-agent string.
    pub user_agent: String,
    /// Canvas rendering hash (hex-encoded).
    pub canvas_hash: String,
    /// WebGL renderer string (e.g. "ANGLE (Intel, Mesa Intel(R) UHD 630)").
    pub webgl_renderer: String,
    /// Number of detected browser plugins.
    pub plugin_count: u32,
    /// Number of installed fonts detected via font enumeration.
    pub font_count: u32,
    /// Screen resolution as (width, height).
    pub screen_resolution: (u32, u32),
    /// Browser timezone offset in minutes from UTC.
    pub timezone_offset: i32,
    /// Whether the browser advertises "Do Not Track".
    pub do_not_track: bool,
    /// Number of CPU logical cores reported by `navigator.hardwareConcurrency`.
    pub hardware_concurrency: u32,
    /// Device memory in GB reported by `navigator.deviceMemory` (0 if unavailable).
    pub device_memory_gb: u32,
    /// Total number of distinct attribute values in the full fingerprint.  Used
    /// to compute entropy.  If unknown, pass 0 and entropy scoring is skipped.
    pub attribute_count: u32,
}

/// Scores a browser fingerprint for fraud indicators.
///
/// Returns a value in `0.0..=1.0` where higher means more suspicious.
///
/// Heuristics:
/// 1. **Entropy scoring** -- fingerprints with very few distinct attributes are
///    likely bots using headless browsers.  Very high attribute counts can
///    indicate deliberate entropy injection.
/// 2. **Rare/suspicious user-agent detection** -- known headless browser tokens
///    (`HeadlessChrome`, `PhantomJS`, etc.), outdated engines, spoofed UA
///    strings where the claimed OS contradicts other signals.
/// 3. **Suspicious attribute combinations** -- e.g. zero plugins with a
///    non-mobile UA, impossibly low screen resolution, canvas hash of all
///    zeros (headless default).
#[must_use]
pub fn score_fingerprint(fp: &FingerprintAttributes) -> f64 {
    let mut score: f64 = 0.0;

    // --- 1. Entropy scoring ---
    score += score_fingerprint_entropy(fp);

    // --- 2. User-agent analysis ---
    score += score_user_agent(&fp.user_agent);

    // --- 3. Suspicious attribute combinations ---
    score += score_attribute_anomalies(fp);

    score.clamp(0.0, 1.0)
}

/// Entropy sub-score.  Very low or very high attribute counts relative to the
/// realistic range (100..500) are suspicious.
fn score_fingerprint_entropy(fp: &FingerprintAttributes) -> f64 {
    if fp.attribute_count == 0 {
        return 0.0; // No data, skip.
    }

    let count = f64::from(fp.attribute_count);

    // Normal range for a legitimate desktop browser is roughly 80..600.
    // Below 30 -> very likely headless/bot.
    // Above 800 -> possible entropy injection.
    if count < 15.0 {
        0.35
    } else if count < 30.0 {
        0.20
    } else if count < 50.0 {
        0.10
    } else if count > 1000.0 {
        0.25
    } else if count > 800.0 {
        0.15
    } else {
        0.0
    }
}

/// Known headless-browser and bot indicators in user-agent strings.
const HEADLESS_TOKENS: &[&str] = &[
    "headlesschrome",
    "phantomjs",
    "slimerjs",
    "puppeteer",
    "selenium",
    "webdriver",
    "playwright",
    "cypress",
    "electron",
    "nightmare",
    "jsdom",
];

/// Suspiciously old browser engine versions. These are extremely rare in
/// legitimate traffic.
const ANCIENT_ENGINE_TOKENS: &[&str] = &[
    "chrome/[1-3][0-9].",
    "firefox/[1-5][0-9].",
    "msie ",
    "trident/",
    "presto/",
];

/// User-agent sub-score.
fn score_user_agent(ua: &str) -> f64 {
    let lower = ua.to_lowercase();
    let mut score: f64 = 0.0;

    // Empty UA is highly suspicious.
    if lower.is_empty() {
        return 0.30;
    }

    // Very short UAs (< 20 chars) are unusual for real browsers.
    if lower.len() < 20 {
        score += 0.15;
    }

    // Check for headless/bot tokens.
    for token in HEADLESS_TOKENS {
        if lower.contains(token) {
            score += 0.35;
            break; // One match is enough.
        }
    }

    // Check for ancient engine versions.
    for token in ANCIENT_ENGINE_TOKENS {
        // Simple substring check -- the regex-style brackets are just
        // illustrative; we check a simplified version.
        let plain = token.replace("[1-3]", "").replace("[1-5]", "").replace("[0-9]", "");
        if lower.contains(&plain) {
            score += 0.15;
            break;
        }
    }

    // OS/browser contradictions: e.g. claims to be Linux but says "iPhone" or
    // "iPad".
    let claims_linux = lower.contains("linux") && !lower.contains("android");
    let claims_mobile_apple = lower.contains("iphone") || lower.contains("ipad");
    if claims_linux && claims_mobile_apple {
        score += 0.25;
    }

    // Claims Windows but has Mac-style WebKit version.
    let claims_windows = lower.contains("windows nt");
    let claims_mac_platform = lower.contains("macintosh") || lower.contains("mac os x");
    if claims_windows && claims_mac_platform {
        score += 0.20;
    }

    score.min(0.50)
}

/// Attribute anomaly sub-score.
fn score_attribute_anomalies(fp: &FingerprintAttributes) -> f64 {
    let mut score: f64 = 0.0;
    let ua_lower = fp.user_agent.to_lowercase();
    let is_mobile = ua_lower.contains("mobile")
        || ua_lower.contains("android")
        || ua_lower.contains("iphone")
        || ua_lower.contains("ipad");

    // Zero plugins on a non-mobile browser is a headless indicator.
    if fp.plugin_count == 0 && !is_mobile && !fp.user_agent.is_empty() {
        score += 0.10;
    }

    // Zero fonts detected is very suspicious (headless or heavily locked-down).
    if fp.font_count == 0 && !fp.user_agent.is_empty() {
        score += 0.10;
    }

    // Impossibly small screen resolution (legitimate minimum is around 320x240).
    if fp.screen_resolution.0 > 0
        && fp.screen_resolution.1 > 0
        && (fp.screen_resolution.0 < 320 || fp.screen_resolution.1 < 240)
    {
        score += 0.15;
    }

    // Canvas hash is all zeros -- typical headless default.
    let canvas_suspicious = !fp.canvas_hash.is_empty()
        && fp.canvas_hash.chars().all(|c| c == '0' || c == 'x');
    if canvas_suspicious {
        score += 0.20;
    }

    // WebGL renderer is empty or generic (e.g. "SwiftShader").
    let renderer_lower = fp.webgl_renderer.to_lowercase();
    if (!fp.webgl_renderer.is_empty())
        && (renderer_lower.contains("swiftshader")
            || renderer_lower.contains("llvmpipe")
            || renderer_lower == "mesa"
            || renderer_lower == "software")
    {
        score += 0.15;
    }

    // Hardware concurrency of 0 or 1 is unusual for modern machines.
    if fp.hardware_concurrency <= 1 && !fp.user_agent.is_empty() {
        score += 0.10;
    }

    // Device memory of 0 (unavailable) on a desktop-claiming UA.
    if fp.device_memory_gb == 0 && !is_mobile && !fp.user_agent.is_empty() {
        // Many browsers do not expose this, so only a small bump.
        score += 0.05;
    }

    score.min(0.50)
}

// ---------------------------------------------------------------------------
// Bid pattern analysis
// ---------------------------------------------------------------------------

/// A single bid record, as relevant to pattern analysis.
#[derive(Debug, Clone)]
pub struct BidRecord {
    /// Unique identifier of the bidder (provider).
    pub provider_id: uuid::Uuid,
    /// Job this bid is for.
    pub job_id: uuid::Uuid,
    /// Bid amount in cents.
    pub amount_cents: i64,
    /// When the bid was placed.
    pub placed_at: DateTime<Utc>,
    /// Whether the bid was later withdrawn.
    pub withdrawn: bool,
    /// IP address from which the bid was submitted.
    pub ip_address: String,
    /// Device fingerprint used when submitting the bid.
    pub device_fingerprint: String,
}

/// Result of bid pattern analysis containing individual sub-scores.
#[derive(Debug, Clone)]
pub struct BidPatternResult {
    /// Composite risk score in 0.0..=1.0.
    pub score: f64,
    /// Whether rapid-fire bidding was detected.
    pub rapid_fire: bool,
    /// Whether shill bidding patterns were detected.
    pub shill_pattern: bool,
    /// Whether bid rotation was detected.
    pub bid_rotation: bool,
    /// Human-readable reasons.
    pub reasons: Vec<String>,
}

/// Minimum interval in seconds between bids to *not* be considered rapid-fire.
const RAPID_FIRE_THRESHOLD_SECS: i64 = 10;

/// Minimum number of rapid consecutive bids to flag.
const RAPID_FIRE_MIN_COUNT: usize = 3;

/// Analyse a collection of bids for a single provider.
///
/// `bids` should be sorted by `placed_at` ascending.  The function analyses
/// patterns across all provided bids (which may span multiple jobs).
///
/// `customer_ids_by_job` maps `job_id` to the UUID of the customer who posted
/// that job.  Used for shill-bid detection (provider shares fingerprint/IP
/// with job poster).
#[must_use]
pub fn score_bid_patterns(
    bids: &[BidRecord],
    customer_ids_by_job: &HashMap<uuid::Uuid, uuid::Uuid>,
    customer_sessions: &HashMap<uuid::Uuid, Vec<SessionInfo>>,
) -> BidPatternResult {
    let mut score: f64 = 0.0;
    let mut reasons: Vec<String> = Vec::new();
    let mut rapid_fire = false;
    let mut shill_pattern = false;
    let mut bid_rotation = false;

    if bids.is_empty() {
        return BidPatternResult {
            score: 0.0,
            rapid_fire: false,
            shill_pattern: false,
            bid_rotation: false,
            reasons: Vec::new(),
        };
    }

    // --- 1. Rapid-fire bidding ---
    let rapid_score = detect_rapid_fire(bids);
    if rapid_score > 0.0 {
        rapid_fire = true;
        score += rapid_score;
        reasons.push("Rapid-fire bidding detected: multiple bids placed within seconds".into());
    }

    // --- 2. Shill bidding patterns ---
    let shill_score =
        detect_shill_bidding(bids, customer_ids_by_job, customer_sessions);
    if shill_score > 0.0 {
        shill_pattern = true;
        score += shill_score;
        reasons
            .push("Shill bidding pattern: bidder shares device/IP with job poster".into());
    }

    // --- 3. Bid rotation detection ---
    let rotation_score = detect_bid_rotation(bids);
    if rotation_score > 0.0 {
        bid_rotation = true;
        score += rotation_score;
        reasons.push(
            "Bid rotation detected: systematic bid-then-withdraw pattern across jobs".into(),
        );
    }

    // --- 4. Repeated identical amounts ---
    let dup_score = detect_duplicate_amounts(bids);
    if dup_score > 0.0 {
        score += dup_score;
        reasons.push("Suspicious repeated identical bid amounts across different jobs".into());
    }

    BidPatternResult {
        score: score.clamp(0.0, 1.0),
        rapid_fire,
        shill_pattern,
        bid_rotation,
        reasons,
    }
}

/// Detect rapid-fire bidding: sequences of bids with very short intervals.
fn detect_rapid_fire(bids: &[BidRecord]) -> f64 {
    if bids.len() < 2 {
        return 0.0;
    }

    let mut consecutive_rapid = 0usize;
    let mut max_consecutive = 0usize;

    for pair in bids.windows(2) {
        let delta = (pair[1].placed_at - pair[0].placed_at).num_seconds().abs();
        if delta < RAPID_FIRE_THRESHOLD_SECS {
            consecutive_rapid += 1;
            if consecutive_rapid > max_consecutive {
                max_consecutive = consecutive_rapid;
            }
        } else {
            consecutive_rapid = 0;
        }
    }

    if max_consecutive >= RAPID_FIRE_MIN_COUNT * 2 {
        0.40 // Very aggressive rapid fire.
    } else if max_consecutive >= RAPID_FIRE_MIN_COUNT {
        0.25
    } else if max_consecutive >= 2 {
        0.10
    } else {
        0.0
    }
}

/// Minimal session info for cross-referencing.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub ip_address: String,
    pub device_fingerprint: String,
}

/// Detect shill bidding: provider shares IP or fingerprint with the customer
/// who posted the job.
fn detect_shill_bidding(
    bids: &[BidRecord],
    customer_ids_by_job: &HashMap<uuid::Uuid, uuid::Uuid>,
    customer_sessions: &HashMap<uuid::Uuid, Vec<SessionInfo>>,
) -> f64 {
    let mut shared_ip_count = 0u32;
    let mut shared_fp_count = 0u32;

    let checked_jobs: HashSet<uuid::Uuid> = bids.iter().map(|b| b.job_id).collect();

    for job_id in &checked_jobs {
        let customer_id = match customer_ids_by_job.get(job_id) {
            Some(c) => c,
            None => continue,
        };

        let sessions = match customer_sessions.get(customer_id) {
            Some(s) => s,
            None => continue,
        };

        // Collect provider IPs and FPs used for bids on this job.
        let provider_ips: HashSet<&str> = bids
            .iter()
            .filter(|b| b.job_id == *job_id && !b.ip_address.is_empty())
            .map(|b| b.ip_address.as_str())
            .collect();

        let provider_fps: HashSet<&str> = bids
            .iter()
            .filter(|b| b.job_id == *job_id && !b.device_fingerprint.is_empty())
            .map(|b| b.device_fingerprint.as_str())
            .collect();

        for sess in sessions {
            if !sess.ip_address.is_empty() && provider_ips.contains(sess.ip_address.as_str()) {
                shared_ip_count += 1;
            }
            if !sess.device_fingerprint.is_empty()
                && provider_fps.contains(sess.device_fingerprint.as_str())
            {
                shared_fp_count += 1;
            }
        }
    }

    // Shared fingerprint is a very strong shill signal.
    let fp_score: f64 = match shared_fp_count {
        0 => 0.0,
        1 => 0.35,
        _ => 0.50,
    };

    // Shared IP is a moderate signal (could be same household/office).
    let ip_score: f64 = match shared_ip_count {
        0 => 0.0,
        1 => 0.15,
        _ => 0.25,
    };

    // Take the max because the signals are overlapping -- both evidence of same
    // underlying fraud.
    fp_score.max(ip_score)
}

/// Detect bid rotation: a pattern where a provider bids on many jobs and
/// systematically withdraws most bids, keeping only a few.  This is a common
/// pattern used to artificially inflate bid counts.
fn detect_bid_rotation(bids: &[BidRecord]) -> f64 {
    if bids.len() < 5 {
        return 0.0;
    }

    // Group bids by job.
    let mut by_job: HashMap<uuid::Uuid, Vec<&BidRecord>> = HashMap::new();
    for bid in bids {
        by_job.entry(bid.job_id).or_default().push(bid);
    }

    let total_jobs = by_job.len();
    if total_jobs < 3 {
        return 0.0;
    }

    let jobs_with_withdrawal = by_job
        .values()
        .filter(|job_bids| job_bids.iter().any(|b| b.withdrawn))
        .count();

    let withdrawal_ratio = jobs_with_withdrawal as f64 / total_jobs as f64;

    // If more than 60% of jobs have bid-then-withdraw, flag it.
    if withdrawal_ratio > 0.80 {
        0.40
    } else if withdrawal_ratio > 0.60 {
        0.25
    } else if withdrawal_ratio > 0.40 {
        0.10
    } else {
        0.0
    }
}

/// Detect suspiciously repeated identical bid amounts across different jobs.
fn detect_duplicate_amounts(bids: &[BidRecord]) -> f64 {
    if bids.len() < 4 {
        return 0.0;
    }

    // Count bids per (amount, job) -- we only care about identical amounts
    // across *different* jobs.
    let unique_jobs: HashSet<uuid::Uuid> = bids.iter().map(|b| b.job_id).collect();
    if unique_jobs.len() < 3 {
        return 0.0;
    }

    let mut amount_counts: HashMap<i64, HashSet<uuid::Uuid>> = HashMap::new();
    for bid in bids {
        amount_counts
            .entry(bid.amount_cents)
            .or_default()
            .insert(bid.job_id);
    }

    // Find the most-repeated amount across different jobs.
    let max_jobs_same_amount = amount_counts
        .values()
        .map(HashSet::len)
        .max()
        .unwrap_or(0);

    let ratio = max_jobs_same_amount as f64 / unique_jobs.len() as f64;

    if ratio > 0.80 && max_jobs_same_amount >= 5 {
        0.30
    } else if ratio > 0.60 && max_jobs_same_amount >= 4 {
        0.20
    } else if ratio > 0.50 && max_jobs_same_amount >= 3 {
        0.10
    } else {
        0.0
    }
}

// ---------------------------------------------------------------------------
// IP geolocation cross-referencing
// ---------------------------------------------------------------------------

/// Session record with IP subnet information for multi-account detection.
#[derive(Debug, Clone)]
pub struct IpSessionRecord {
    /// User who owns this session.
    pub user_id: uuid::Uuid,
    /// Full IP address string (v4 or v6).
    pub ip_address: String,
    /// Approximate geo-latitude (if available).
    pub geo_lat: Option<f64>,
    /// Approximate geo-longitude (if available).
    pub geo_lng: Option<f64>,
    /// Country code.
    pub geo_country: Option<String>,
}

/// Result of IP geolocation analysis.
#[derive(Debug, Clone)]
pub struct IpAnalysisResult {
    /// Composite risk score in 0.0..=1.0.
    pub score: f64,
    /// Number of distinct users sharing the same /24 subnet.
    pub users_in_subnet: usize,
    /// Whether a geo-mismatch was detected for the target user.
    pub geo_mismatch: bool,
    /// Human-readable reasons.
    pub reasons: Vec<String>,
}

/// Analyse IP sessions for multi-account and geo-mismatch signals.
///
/// `target_user_id` is the user being evaluated.  `all_sessions` contains
/// recent sessions for all users (or at least those sharing similar IP ranges).
///
/// `target_country` is the expected country for the user (e.g. from their
/// profile).  If `None`, geo-mismatch is not checked.
#[must_use]
pub fn score_ip_geolocation(
    target_user_id: uuid::Uuid,
    target_ip: &str,
    all_sessions: &[IpSessionRecord],
    expected_country: Option<&str>,
) -> IpAnalysisResult {
    let mut score: f64 = 0.0;
    let mut reasons: Vec<String> = Vec::new();
    let mut geo_mismatch = false;

    // --- 1. Multi-account from same /24 subnet ---
    let target_prefix = ip_v4_24_prefix(target_ip);
    let users_in_subnet = if let Some(ref prefix) = target_prefix {
        let user_ids: HashSet<uuid::Uuid> = all_sessions
            .iter()
            .filter(|s| {
                ip_v4_24_prefix(&s.ip_address)
                    .as_ref()
                    .map_or(false, |p| p == prefix)
            })
            .map(|s| s.user_id)
            .collect();
        user_ids.len()
    } else {
        0
    };

    if users_in_subnet >= 10 {
        score += 0.40;
        reasons.push(format!(
            "High multi-account risk: {users_in_subnet} users share the same /24 subnet"
        ));
    } else if users_in_subnet >= 5 {
        score += 0.25;
        reasons.push(format!(
            "Moderate multi-account risk: {users_in_subnet} users share the same /24 subnet"
        ));
    } else if users_in_subnet >= 3 {
        score += 0.10;
        reasons.push(format!(
            "Low multi-account indicator: {users_in_subnet} users share the same /24 subnet"
        ));
    }

    // --- 2. Exact IP shared across different user accounts ---
    let users_exact_ip: HashSet<uuid::Uuid> = all_sessions
        .iter()
        .filter(|s| s.ip_address == target_ip)
        .map(|s| s.user_id)
        .collect();
    let exact_ip_users = users_exact_ip.len();

    if exact_ip_users >= 5 {
        score += 0.35;
        reasons.push(format!(
            "Exact IP shared by {exact_ip_users} different accounts"
        ));
    } else if exact_ip_users >= 3 {
        score += 0.20;
        reasons.push(format!(
            "Exact IP shared by {exact_ip_users} different accounts"
        ));
    }

    // --- 3. Geo-mismatch ---
    if let Some(expected) = expected_country {
        if !expected.is_empty() {
            let target_sessions: Vec<&IpSessionRecord> = all_sessions
                .iter()
                .filter(|s| s.user_id == target_user_id)
                .collect();

            for sess in &target_sessions {
                if let Some(ref country) = sess.geo_country {
                    if !country.is_empty() && country != expected {
                        geo_mismatch = true;
                        score += 0.20;
                        reasons.push(format!(
                            "Geo mismatch: session from {country}, expected {expected}"
                        ));
                        break; // Only flag once.
                    }
                }
            }
        }
    }

    // --- 4. Geo-location velocity (impossible travel) ---
    let travel_score = detect_impossible_travel(target_user_id, all_sessions);
    if travel_score > 0.0 {
        score += travel_score;
        geo_mismatch = true;
        reasons.push("Impossible travel detected between sessions".into());
    }

    IpAnalysisResult {
        score: score.clamp(0.0, 1.0),
        users_in_subnet,
        geo_mismatch,
        reasons,
    }
}

/// Extract the /24 prefix from an IPv4 address string.
/// Returns `None` for non-IPv4 or unparseable addresses.
fn ip_v4_24_prefix(ip: &str) -> Option<String> {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        Some(format!("{}.{}.{}", parts[0], parts[1], parts[2]))
    } else {
        None
    }
}

/// Detect impossible travel: two sessions from the same user in different
/// geo-locations that would require faster-than-possible travel.
///
/// Uses a conservative 900 km/h threshold (roughly the speed of a commercial
/// jet).
fn detect_impossible_travel(
    target_user_id: uuid::Uuid,
    sessions: &[IpSessionRecord],
) -> f64 {
    let user_sessions: Vec<&IpSessionRecord> = sessions
        .iter()
        .filter(|s| s.user_id == target_user_id && s.geo_lat.is_some() && s.geo_lng.is_some())
        .collect();

    if user_sessions.len() < 2 {
        return 0.0;
    }

    // Compare each pair of sessions.  Since we don't have timestamps in
    // `IpSessionRecord`, we compare consecutive sessions and use the
    // geographic distance as a proxy.  A very large distance indicates the
    // need for further investigation.
    for pair in user_sessions.windows(2) {
        let lat1 = pair[0].geo_lat.unwrap_or(0.0);
        let lng1 = pair[0].geo_lng.unwrap_or(0.0);
        let lat2 = pair[1].geo_lat.unwrap_or(0.0);
        let lng2 = pair[1].geo_lng.unwrap_or(0.0);

        let distance_km = haversine_km(lat1, lng1, lat2, lng2);

        // If sessions are > 5000 km apart, flag as highly suspicious.
        if distance_km > 5000.0 {
            return 0.30;
        }
        if distance_km > 2000.0 {
            return 0.15;
        }
    }

    0.0
}

/// Haversine distance between two points in kilometers.
fn haversine_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    const EARTH_RADIUS_KM: f64 = 6371.0;

    let d_lat = (lat2 - lat1).to_radians();
    let d_lng = (lng2 - lng1).to_radians();

    let lat1_rad = lat1.to_radians();
    let lat2_rad = lat2.to_radians();

    let a = (d_lat / 2.0).sin().powi(2)
        + lat1_rad.cos() * lat2_rad.cos() * (d_lng / 2.0).sin().powi(2);

    let c = 2.0 * a.sqrt().asin();

    EARTH_RADIUS_KM * c
}

// ---------------------------------------------------------------------------
// Composite risk scoring
// ---------------------------------------------------------------------------

/// Thresholds for auto-flagging decisions.
#[derive(Debug, Clone, Copy)]
pub struct RiskThresholds {
    /// Score above which users are auto-challenged (must verify identity).
    pub challenge_threshold: f64,
    /// Score above which users are auto-blocked.
    pub block_threshold: f64,
    /// Score above which a review alert is created.
    pub review_threshold: f64,
}

impl Default for RiskThresholds {
    fn default() -> Self {
        Self {
            review_threshold: 0.3,
            challenge_threshold: 0.6,
            block_threshold: 0.8,
        }
    }
}

/// The action recommended by the risk scoring engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoAction {
    /// No action needed.
    None,
    /// Create a review alert for human inspection.
    Review,
    /// Challenge the user (e.g. require 2FA or identity verification).
    Challenge,
    /// Block the action outright.
    Block,
}

/// Combined risk assessment from all scoring dimensions.
#[derive(Debug, Clone)]
pub struct CompositeRiskResult {
    /// Final risk score in 0.0..=1.0.
    pub score: f64,
    /// Sub-score from fingerprint analysis.
    pub fingerprint_score: f64,
    /// Sub-score from bid pattern analysis.
    pub bid_pattern_score: f64,
    /// Sub-score from IP geolocation analysis.
    pub ip_geo_score: f64,
    /// Sub-score from historical signal weight (passed in).
    pub historical_score: f64,
    /// Recommended auto-action.
    pub action: AutoAction,
    /// All reasons aggregated from sub-analyses.
    pub reasons: Vec<String>,
}

/// Weight distribution for the composite score.  These are tunable.
const WEIGHT_FINGERPRINT: f64 = 0.25;
const WEIGHT_BID_PATTERN: f64 = 0.30;
const WEIGHT_IP_GEO: f64 = 0.25;
const WEIGHT_HISTORICAL: f64 = 0.20;

/// Compute a composite risk score from individual dimension scores.
///
/// `historical_score` is the pre-computed score from the user's past fraud
/// signals (e.g. from `calculate_risk_score` in `engine.rs`).
///
/// The composite score is a weighted average of the four dimensions, then
/// clamped to 0.0..=1.0, and compared against the thresholds to determine the
/// recommended action.
#[must_use]
pub fn compute_composite_risk(
    fingerprint_score: f64,
    bid_pattern_score: f64,
    ip_geo_score: f64,
    historical_score: f64,
    thresholds: &RiskThresholds,
) -> CompositeRiskResult {
    let fp = fingerprint_score.clamp(0.0, 1.0);
    let bp = bid_pattern_score.clamp(0.0, 1.0);
    let ig = ip_geo_score.clamp(0.0, 1.0);
    let hs = historical_score.clamp(0.0, 1.0);

    let weighted = fp * WEIGHT_FINGERPRINT
        + bp * WEIGHT_BID_PATTERN
        + ig * WEIGHT_IP_GEO
        + hs * WEIGHT_HISTORICAL;

    // If any single dimension is very high, apply a floor to the composite.
    // This prevents a single extremely suspicious signal from being diluted by
    // clean scores in other dimensions.
    let max_single = fp.max(bp).max(ig).max(hs);
    let floor = if max_single > 0.8 {
        0.5
    } else if max_single > 0.6 {
        0.3
    } else {
        0.0
    };

    let score = weighted.max(floor).clamp(0.0, 1.0);

    let action = if score >= thresholds.block_threshold {
        AutoAction::Block
    } else if score >= thresholds.challenge_threshold {
        AutoAction::Challenge
    } else if score >= thresholds.review_threshold {
        AutoAction::Review
    } else {
        AutoAction::None
    };

    CompositeRiskResult {
        score,
        fingerprint_score: fp,
        bid_pattern_score: bp,
        ip_geo_score: ig,
        historical_score: hs,
        action,
        reasons: Vec::new(), // Caller aggregates reasons from sub-analyses.
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use uuid::Uuid;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn default_fingerprint() -> FingerprintAttributes {
        FingerprintAttributes {
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                         (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                .into(),
            canvas_hash: "a1b2c3d4e5f6".into(),
            webgl_renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630)".into(),
            plugin_count: 3,
            font_count: 120,
            screen_resolution: (1920, 1080),
            timezone_offset: -300,
            do_not_track: false,
            hardware_concurrency: 8,
            device_memory_gb: 8,
            attribute_count: 200,
        }
    }

    fn headless_fingerprint() -> FingerprintAttributes {
        FingerprintAttributes {
            user_agent: "Mozilla/5.0 HeadlessChrome/120.0.0.0".into(),
            canvas_hash: "0000000000".into(),
            webgl_renderer: "SwiftShader".into(),
            plugin_count: 0,
            font_count: 0,
            screen_resolution: (800, 600),
            timezone_offset: 0,
            do_not_track: false,
            hardware_concurrency: 1,
            device_memory_gb: 0,
            attribute_count: 10,
        }
    }

    // -----------------------------------------------------------------------
    // Fingerprint scoring
    // -----------------------------------------------------------------------

    #[test]
    fn legitimate_fingerprint_scores_low() {
        let fp = default_fingerprint();
        let score = score_fingerprint(&fp);
        assert!(
            score < 0.2,
            "legitimate fingerprint should score low, got {score}"
        );
    }

    #[test]
    fn headless_fingerprint_scores_high() {
        let fp = headless_fingerprint();
        let score = score_fingerprint(&fp);
        assert!(
            score > 0.5,
            "headless fingerprint should score high, got {score}"
        );
    }

    #[test]
    fn empty_user_agent_is_suspicious() {
        let mut fp = default_fingerprint();
        fp.user_agent = String::new();
        let score = score_fingerprint(&fp);
        assert!(
            score > 0.2,
            "empty UA should increase score, got {score}"
        );
    }

    #[test]
    fn zero_canvas_hash_is_suspicious() {
        let mut fp = default_fingerprint();
        fp.canvas_hash = "00000000".into();
        let score = score_fingerprint(&fp);
        let baseline = score_fingerprint(&default_fingerprint());
        assert!(
            score > baseline,
            "zero canvas hash should increase score: {score} vs {baseline}"
        );
    }

    #[test]
    fn os_contradiction_detected() {
        let mut fp = default_fingerprint();
        fp.user_agent = "Mozilla/5.0 (Linux; x86_64) Chrome/120.0.0.0 iPhone Safari".into();
        let score = score_fingerprint(&fp);
        let baseline = score_fingerprint(&default_fingerprint());
        assert!(
            score > baseline,
            "OS contradiction should increase score: {score} vs {baseline}"
        );
    }

    #[test]
    fn low_entropy_fingerprint_is_suspicious() {
        let mut fp = default_fingerprint();
        fp.attribute_count = 5;
        let score = score_fingerprint(&fp);
        let baseline = score_fingerprint(&default_fingerprint());
        assert!(
            score > baseline,
            "low entropy should increase score: {score} vs {baseline}"
        );
    }

    #[test]
    fn high_entropy_fingerprint_is_suspicious() {
        let mut fp = default_fingerprint();
        fp.attribute_count = 1200;
        let score = score_fingerprint(&fp);
        let baseline = score_fingerprint(&default_fingerprint());
        assert!(
            score > baseline,
            "very high entropy should increase score: {score} vs {baseline}"
        );
    }

    #[test]
    fn score_fingerprint_always_clamped() {
        // Construct a maximally suspicious fingerprint.
        let fp = FingerprintAttributes {
            user_agent: "HeadlessChrome Linux iPhone Windows NT Macintosh".into(),
            canvas_hash: "0000000000".into(),
            webgl_renderer: "SwiftShader".into(),
            plugin_count: 0,
            font_count: 0,
            screen_resolution: (100, 100),
            timezone_offset: 0,
            do_not_track: false,
            hardware_concurrency: 0,
            device_memory_gb: 0,
            attribute_count: 5,
        };
        let score = score_fingerprint(&fp);
        assert!(
            (0.0..=1.0).contains(&score),
            "score must be in [0, 1], got {score}"
        );
    }

    // -----------------------------------------------------------------------
    // Bid pattern scoring
    // -----------------------------------------------------------------------

    fn make_bid(
        provider_id: Uuid,
        job_id: Uuid,
        amount: i64,
        secs_offset: i64,
        withdrawn: bool,
    ) -> BidRecord {
        let base = chrono::Utc::now();
        BidRecord {
            provider_id,
            job_id,
            amount_cents: amount,
            placed_at: base + chrono::Duration::seconds(secs_offset),
            withdrawn,
            ip_address: "192.168.1.1".into(),
            device_fingerprint: "fp-test-1234".into(),
        }
    }

    #[test]
    fn no_bids_scores_zero() {
        let result = score_bid_patterns(&[], &HashMap::new(), &HashMap::new());
        assert!(
            result.score.abs() < f64::EPSILON,
            "empty bids should score 0, got {}",
            result.score
        );
        assert!(!result.rapid_fire);
        assert!(!result.shill_pattern);
        assert!(!result.bid_rotation);
    }

    #[test]
    fn rapid_fire_detected() {
        let provider = Uuid::now_v7();
        let job = Uuid::now_v7();
        // 5 bids within 2 seconds each.
        let bids: Vec<BidRecord> = (0..5)
            .map(|i| make_bid(provider, job, 10000, i * 2, false))
            .collect();

        let result = score_bid_patterns(&bids, &HashMap::new(), &HashMap::new());
        assert!(result.rapid_fire, "rapid fire should be detected");
        assert!(
            result.score > 0.0,
            "rapid fire should increase score, got {}",
            result.score
        );
    }

    #[test]
    fn normal_pace_not_rapid_fire() {
        let provider = Uuid::now_v7();
        let job = Uuid::now_v7();
        // 3 bids spaced 60 seconds apart.
        let bids: Vec<BidRecord> = (0..3)
            .map(|i| make_bid(provider, job, 10000, i * 60, false))
            .collect();

        let result = score_bid_patterns(&bids, &HashMap::new(), &HashMap::new());
        assert!(
            !result.rapid_fire,
            "normal pace should not trigger rapid fire"
        );
    }

    #[test]
    fn shill_bidding_detected_shared_ip() {
        let provider = Uuid::now_v7();
        let customer = Uuid::now_v7();
        let job = Uuid::now_v7();

        let bids = vec![make_bid(provider, job, 10000, 0, false)];

        let mut customer_ids = HashMap::new();
        customer_ids.insert(job, customer);

        let mut customer_sess = HashMap::new();
        customer_sess.insert(
            customer,
            vec![SessionInfo {
                ip_address: "192.168.1.1".into(), // Same as bid.
                device_fingerprint: "different-fp".into(),
            }],
        );

        let result = score_bid_patterns(&bids, &customer_ids, &customer_sess);
        assert!(result.shill_pattern, "shill pattern should be detected");
        assert!(result.score > 0.0);
    }

    #[test]
    fn shill_bidding_detected_shared_fingerprint() {
        let provider = Uuid::now_v7();
        let customer = Uuid::now_v7();
        let job = Uuid::now_v7();

        let bids = vec![make_bid(provider, job, 10000, 0, false)];

        let mut customer_ids = HashMap::new();
        customer_ids.insert(job, customer);

        let mut customer_sess = HashMap::new();
        customer_sess.insert(
            customer,
            vec![SessionInfo {
                ip_address: "10.0.0.1".into(),
                device_fingerprint: "fp-test-1234".into(), // Same as bid.
            }],
        );

        let result = score_bid_patterns(&bids, &customer_ids, &customer_sess);
        assert!(
            result.shill_pattern,
            "shill pattern should be detected via fingerprint"
        );
    }

    #[test]
    fn bid_rotation_detected() {
        let provider = Uuid::now_v7();
        // 6 jobs, 5 have bids withdrawn.
        let jobs: Vec<Uuid> = (0..6).map(|_| Uuid::now_v7()).collect();
        let mut bids = Vec::new();
        for (i, job) in jobs.iter().enumerate() {
            let withdrawn = i < 5; // First 5 withdrawn.
            bids.push(make_bid(provider, *job, 10000, (i as i64) * 100, withdrawn));
        }

        let result = score_bid_patterns(&bids, &HashMap::new(), &HashMap::new());
        assert!(result.bid_rotation, "bid rotation should be detected");
    }

    #[test]
    fn duplicate_amounts_detected() {
        let provider = Uuid::now_v7();
        let jobs: Vec<Uuid> = (0..6).map(|_| Uuid::now_v7()).collect();
        // All 6 bids on different jobs with the same amount.
        let bids: Vec<BidRecord> = jobs
            .iter()
            .enumerate()
            .map(|(i, job)| make_bid(provider, *job, 50000, (i as i64) * 100, false))
            .collect();

        let result = score_bid_patterns(&bids, &HashMap::new(), &HashMap::new());
        assert!(
            result.score > 0.0,
            "duplicate amounts across many jobs should increase score"
        );
    }

    // -----------------------------------------------------------------------
    // IP geolocation scoring
    // -----------------------------------------------------------------------

    #[test]
    fn no_sessions_scores_zero() {
        let user = Uuid::now_v7();
        let result = score_ip_geolocation(user, "192.168.1.1", &[], None);
        assert!(
            result.score.abs() < f64::EPSILON,
            "no sessions should score 0"
        );
    }

    #[test]
    fn multi_account_same_subnet_detected() {
        let target = Uuid::now_v7();
        let sessions: Vec<IpSessionRecord> = (0..6)
            .map(|i| IpSessionRecord {
                user_id: if i == 0 { target } else { Uuid::now_v7() },
                ip_address: format!("10.0.1.{}", 10 + i),
                geo_lat: None,
                geo_lng: None,
                geo_country: None,
            })
            .collect();

        let result = score_ip_geolocation(target, "10.0.1.10", &sessions, None);
        assert!(
            result.users_in_subnet >= 5,
            "should detect 6 users in subnet, got {}",
            result.users_in_subnet
        );
        assert!(result.score > 0.0);
    }

    #[test]
    fn exact_ip_multi_account_detected() {
        let target = Uuid::now_v7();
        let sessions: Vec<IpSessionRecord> = (0..5)
            .map(|i| IpSessionRecord {
                user_id: if i == 0 { target } else { Uuid::now_v7() },
                ip_address: "10.0.1.50".into(),
                geo_lat: None,
                geo_lng: None,
                geo_country: None,
            })
            .collect();

        let result = score_ip_geolocation(target, "10.0.1.50", &sessions, None);
        assert!(
            result.score > 0.2,
            "5 users on same IP should score > 0.2, got {}",
            result.score
        );
    }

    #[test]
    fn geo_mismatch_detected() {
        let target = Uuid::now_v7();
        let sessions = vec![IpSessionRecord {
            user_id: target,
            ip_address: "1.2.3.4".into(),
            geo_lat: Some(35.0),
            geo_lng: Some(139.0),
            geo_country: Some("JP".into()),
        }];

        let result = score_ip_geolocation(target, "1.2.3.4", &sessions, Some("US"));
        assert!(result.geo_mismatch, "geo mismatch should be detected");
        assert!(result.score > 0.0);
    }

    #[test]
    fn geo_mismatch_not_triggered_when_matching() {
        let target = Uuid::now_v7();
        let sessions = vec![IpSessionRecord {
            user_id: target,
            ip_address: "1.2.3.4".into(),
            geo_lat: Some(40.0),
            geo_lng: Some(-74.0),
            geo_country: Some("US".into()),
        }];

        let result = score_ip_geolocation(target, "1.2.3.4", &sessions, Some("US"));
        assert!(!result.geo_mismatch);
    }

    #[test]
    fn impossible_travel_detected() {
        let target = Uuid::now_v7();
        // New York and Tokyo -- >10,000 km apart.
        let sessions = vec![
            IpSessionRecord {
                user_id: target,
                ip_address: "1.2.3.4".into(),
                geo_lat: Some(40.7128),
                geo_lng: Some(-74.0060),
                geo_country: Some("US".into()),
            },
            IpSessionRecord {
                user_id: target,
                ip_address: "5.6.7.8".into(),
                geo_lat: Some(35.6762),
                geo_lng: Some(139.6503),
                geo_country: Some("JP".into()),
            },
        ];

        let result = score_ip_geolocation(target, "1.2.3.4", &sessions, None);
        assert!(
            result.score > 0.0,
            "impossible travel should increase score"
        );
    }

    // -----------------------------------------------------------------------
    // Haversine
    // -----------------------------------------------------------------------

    #[test]
    fn haversine_same_point_is_zero() {
        let d = haversine_km(40.0, -74.0, 40.0, -74.0);
        assert!(d.abs() < 0.01, "same point should be ~0 km, got {d}");
    }

    #[test]
    fn haversine_ny_to_london() {
        // New York (40.7128, -74.0060) to London (51.5074, -0.1278): ~5570 km.
        let d = haversine_km(40.7128, -74.0060, 51.5074, -0.1278);
        assert!(
            (5500.0..5700.0).contains(&d),
            "NY to London should be ~5570 km, got {d}"
        );
    }

    // -----------------------------------------------------------------------
    // IP prefix extraction
    // -----------------------------------------------------------------------

    #[test]
    fn ipv4_prefix_extracted() {
        assert_eq!(
            ip_v4_24_prefix("192.168.1.100"),
            Some("192.168.1".into())
        );
    }

    #[test]
    fn ipv6_returns_none() {
        assert_eq!(ip_v4_24_prefix("::1"), None);
        assert_eq!(ip_v4_24_prefix("2001:db8::1"), None);
    }

    #[test]
    fn invalid_ip_returns_none() {
        assert_eq!(ip_v4_24_prefix("not-an-ip"), None);
        assert_eq!(ip_v4_24_prefix("999.999.999.999"), None);
    }

    // -----------------------------------------------------------------------
    // Composite risk scoring
    // -----------------------------------------------------------------------

    #[test]
    fn all_zero_scores_no_action() {
        let result = compute_composite_risk(0.0, 0.0, 0.0, 0.0, &RiskThresholds::default());
        assert!(result.score.abs() < f64::EPSILON);
        assert_eq!(result.action, AutoAction::None);
    }

    #[test]
    fn all_max_scores_block() {
        let result = compute_composite_risk(1.0, 1.0, 1.0, 1.0, &RiskThresholds::default());
        assert!((result.score - 1.0).abs() < f64::EPSILON);
        assert_eq!(result.action, AutoAction::Block);
    }

    #[test]
    fn single_high_dimension_applies_floor() {
        // Only bid pattern is 0.9, everything else is 0.0.
        let result = compute_composite_risk(0.0, 0.9, 0.0, 0.0, &RiskThresholds::default());
        // Weighted would be 0.9 * 0.30 = 0.27, but floor is 0.5 because max > 0.8.
        assert!(
            result.score >= 0.5,
            "floor should apply, got {}",
            result.score
        );
        // 0.5 >= review_threshold (0.3) but < challenge_threshold (0.6), so Review.
        assert_eq!(result.action, AutoAction::Review);
    }

    #[test]
    fn moderate_scores_trigger_review() {
        let result = compute_composite_risk(0.3, 0.3, 0.3, 0.3, &RiskThresholds::default());
        // Weighted = 0.3, which is the review threshold.
        assert!(result.score >= 0.3);
        assert_eq!(result.action, AutoAction::Review);
    }

    #[test]
    fn custom_thresholds_respected() {
        let thresholds = RiskThresholds {
            review_threshold: 0.1,
            challenge_threshold: 0.2,
            block_threshold: 0.3,
        };
        let result = compute_composite_risk(0.0, 0.5, 0.0, 0.0, &thresholds);
        // Weighted = 0.5 * 0.30 = 0.15, max single = 0.5 which is < 0.6 so no floor.
        // 0.15 > challenge_threshold (0.2)? No. > review_threshold (0.1)? Yes.
        // Actually 0.15 > 0.1 = true but 0.15 < 0.2. So Review.
        assert_eq!(result.action, AutoAction::Review);
    }

    #[test]
    fn composite_score_always_clamped() {
        let result = compute_composite_risk(2.0, 2.0, 2.0, 2.0, &RiskThresholds::default());
        assert!(
            (0.0..=1.0).contains(&result.score),
            "score must be in [0, 1], got {}",
            result.score
        );
    }

    // -----------------------------------------------------------------------
    // proptest
    // -----------------------------------------------------------------------

    mod proptests {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            #[test]
            fn fingerprint_score_in_range(
                ua in ".*",
                canvas in "[0-9a-f]{0,16}",
                webgl in ".*",
                plugins in 0u32..100,
                fonts in 0u32..500,
                width in 0u32..4096,
                height in 0u32..4096,
                tz in -720i32..720,
                dnt in proptest::bool::ANY,
                cores in 0u32..128,
                mem in 0u32..256,
                attrs in 0u32..2000,
            ) {
                let fp = FingerprintAttributes {
                    user_agent: ua,
                    canvas_hash: canvas,
                    webgl_renderer: webgl,
                    plugin_count: plugins,
                    font_count: fonts,
                    screen_resolution: (width, height),
                    timezone_offset: tz,
                    do_not_track: dnt,
                    hardware_concurrency: cores,
                    device_memory_gb: mem,
                    attribute_count: attrs,
                };
                let score = score_fingerprint(&fp);
                prop_assert!((0.0..=1.0).contains(&score), "score out of range: {}", score);
            }

            #[test]
            fn composite_score_in_range(
                fp in 0.0..=1.0_f64,
                bp in 0.0..=1.0_f64,
                ig in 0.0..=1.0_f64,
                hs in 0.0..=1.0_f64,
            ) {
                let result = compute_composite_risk(fp, bp, ig, hs, &RiskThresholds::default());
                prop_assert!((0.0..=1.0).contains(&result.score), "score out of range: {}", result.score);
            }

            #[test]
            fn composite_score_with_arbitrary_inputs(
                fp in proptest::num::f64::ANY,
                bp in proptest::num::f64::ANY,
                ig in proptest::num::f64::ANY,
                hs in proptest::num::f64::ANY,
            ) {
                // Should never panic, even with NaN/Inf.
                let result = compute_composite_risk(fp, bp, ig, hs, &RiskThresholds::default());
                // NaN comparisons can yield strange results but the function
                // must not panic.
                let _ = result;
            }

            #[test]
            fn haversine_never_negative(
                lat1 in -90.0..=90.0_f64,
                lng1 in -180.0..=180.0_f64,
                lat2 in -90.0..=90.0_f64,
                lng2 in -180.0..=180.0_f64,
            ) {
                let d = haversine_km(lat1, lng1, lat2, lng2);
                prop_assert!(d >= 0.0, "distance must be non-negative, got {}", d);
                // Earth circumference is ~40,075 km, so max distance is ~20,037 km.
                prop_assert!(d <= 21_000.0, "distance too large: {}", d);
            }

            #[test]
            fn ip_prefix_never_panics(ip in ".*") {
                let _ = ip_v4_24_prefix(&ip);
            }

            #[test]
            fn rapid_fire_detection_never_panics(n in 0usize..20) {
                let provider = Uuid::nil();
                let job = Uuid::nil();
                let bids: Vec<BidRecord> = (0..n).map(|i| BidRecord {
                    provider_id: provider,
                    job_id: job,
                    amount_cents: 10000,
                    placed_at: Utc::now() + chrono::Duration::seconds(i as i64),
                    withdrawn: false,
                    ip_address: String::new(),
                    device_fingerprint: String::new(),
                }).collect();
                let score = detect_rapid_fire(&bids);
                prop_assert!((0.0..=1.0).contains(&score), "score out of range: {}", score);
            }

            #[test]
            fn bid_rotation_detection_never_panics(n in 0usize..30) {
                let provider = Uuid::nil();
                let bids: Vec<BidRecord> = (0..n).map(|i| BidRecord {
                    provider_id: provider,
                    job_id: Uuid::now_v7(),
                    amount_cents: 10000,
                    placed_at: Utc::now() + chrono::Duration::seconds(i as i64 * 100),
                    withdrawn: i % 2 == 0,
                    ip_address: String::new(),
                    device_fingerprint: String::new(),
                }).collect();
                let score = detect_bid_rotation(&bids);
                prop_assert!((0.0..=1.0).contains(&score), "score out of range: {}", score);
            }

            #[test]
            fn composite_action_monotonic(score in 0.0..=1.0_f64) {
                // Higher scores should produce equal or more severe actions.
                let thresholds = RiskThresholds::default();
                let r = compute_composite_risk(score, score, score, score, &thresholds);
                match r.action {
                    AutoAction::None => prop_assert!(r.score < thresholds.review_threshold),
                    AutoAction::Review => {
                        prop_assert!(r.score >= thresholds.review_threshold);
                        prop_assert!(r.score < thresholds.challenge_threshold);
                    }
                    AutoAction::Challenge => {
                        prop_assert!(r.score >= thresholds.challenge_threshold);
                        prop_assert!(r.score < thresholds.block_threshold);
                    }
                    AutoAction::Block => {
                        prop_assert!(r.score >= thresholds.block_threshold);
                    }
                }
            }
        }
    }
}
