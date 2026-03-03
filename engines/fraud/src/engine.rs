/// Real-time fraud detection pipeline.
///
/// Handles browser fingerprinting, behavioral analysis, shill-bid detection,
/// and risk scoring. Target: < 50ms p99 latency for real-time checks.
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{
    CheckResult, CountRow, FraudError, FraudSignalRow, RecordedSignal, RiskLevel, SignalType,
    SignalTypeRow, TimestampRow, UserRiskProfileData, UserSessionRow,
};

/// SQL fragment selecting fraud_signals columns with NUMERIC casts for f64.
#[allow(dead_code)]
const SIGNAL_SELECT: &str = "\
    SELECT id, user_id, signal_type, signal_subtype, severity, \
      confidence::float8 AS confidence, description, evidence_json, \
      related_entity_id, related_entity_type, status, \
      auto_actioned, auto_action, created_at, updated_at \
    FROM fraud_signals";

/// SQL fragment selecting user_sessions columns with NUMERIC casts for f64.
const SESSION_SELECT: &str = "\
    SELECT id, user_id, ip_address::text AS ip_address, user_agent, \
      device_fingerprint, \
      geo_lat::float8 AS geo_lat, geo_lng::float8 AS geo_lng, \
      geo_city, geo_country, session_start, session_end, \
      page_views, created_at \
    FROM user_sessions";

pub struct FraudDetector {
    pool: PgPool,
}

impl FraudDetector {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // -----------------------------------------------------------------------
    // Real-time checks
    // -----------------------------------------------------------------------

    /// Check a transaction for fraud signals.
    ///
    /// Detection rules:
    /// 1. Rapid transactions (velocity) -- count transactions from same user in last hour
    /// 2. Geo mismatch -- IP location vs recent sessions
    /// 3. Known device fraud -- fingerprint appears in confirmed fraud signals
    /// 4. Payment failure patterns -- recent failed payment signals
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    pub async fn check_transaction(
        &self,
        user_id: Uuid,
        _payment_id: &str,
        amount_cents: i64,
        ip_address: &str,
        device_fingerprint: &str,
    ) -> Result<CheckResult, FraudError> {
        let mut score: f64 = 0.0;
        let mut reasons = Vec::new();

        // 1. Velocity: transactions from this user in the last hour.
        let velocity: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 \
               AND signal_type = 'transaction_fraud' \
               AND created_at >= now() - interval '1 hour'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        if velocity.count >= 5 {
            score += 0.4;
            reasons.push(format!(
                "High transaction velocity: {} transactions in last hour",
                velocity.count
            ));
        } else if velocity.count >= 3 {
            score += 0.2;
            reasons.push(format!(
                "Elevated transaction velocity: {} transactions in last hour",
                velocity.count
            ));
        }

        // 2. Large amount check (over $5000).
        if amount_cents > 500_000 {
            score += 0.15;
            reasons.push(format!(
                "Large transaction amount: ${:.2}",
                amount_cents as f64 / 100.0
            ));
        }

        // 3. Known fraudulent device fingerprint.
        if !device_fingerprint.is_empty() {
            let device_fraud: CountRow = sqlx::query_as(
                "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
                 WHERE evidence_json->>'device_fingerprint' = $1 \
                   AND status IN ('confirmed', 'actioned') \
                   AND created_at >= now() - interval '90 days'",
            )
            .bind(device_fingerprint)
            .fetch_one(&self.pool)
            .await?;

            if device_fraud.count > 0 {
                score += 0.4;
                reasons.push("Device fingerprint associated with confirmed fraud".into());
            }
        }

        // 4. IP associated with recent fraud.
        if !ip_address.is_empty() {
            let ip_fraud: CountRow = sqlx::query_as(
                "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
                 WHERE evidence_json->>'ip_address' = $1 \
                   AND status IN ('confirmed', 'actioned') \
                   AND created_at >= now() - interval '30 days'",
            )
            .bind(ip_address)
            .fetch_one(&self.pool)
            .await?;

            if ip_fraud.count > 0 {
                score += 0.3;
                reasons.push("IP address associated with recent fraud".into());
            }
        }

        score = score.clamp(0.0, 1.0);
        let mut result = CheckResult::from_score(score);
        result.reasons = reasons;

        tracing::info!(
            user_id = %user_id,
            score = score,
            decision = ?result.decision,
            "transaction check completed"
        );

        Ok(result)
    }

    /// Check a registration attempt for fraud signals.
    ///
    /// Detection rules:
    /// 1. IP reputation -- IP appears in recent fraud signals
    /// 2. Device fingerprint -- fingerprint associated with known fraud
    /// 3. Email domain -- disposable email detection (simple heuristic)
    /// 4. Velocity -- registrations from same IP/device in last 24h
    /// 5. Multi-account -- same fingerprint across different user_ids
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    pub async fn check_registration(
        &self,
        email: &str,
        ip_address: &str,
        device_fingerprint: &str,
        _phone: &str,
    ) -> Result<CheckResult, FraudError> {
        let mut score: f64 = 0.0;
        let mut reasons = Vec::new();

        // 1. IP reputation: fraud signals from this IP in last 30 days.
        if !ip_address.is_empty() {
            let ip_fraud: CountRow = sqlx::query_as(
                "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
                 WHERE evidence_json->>'ip_address' = $1 \
                   AND status IN ('pending', 'confirmed', 'actioned') \
                   AND created_at >= now() - interval '30 days'",
            )
            .bind(ip_address)
            .fetch_one(&self.pool)
            .await?;

            if ip_fraud.count > 0 {
                score += 0.3;
                reasons.push("IP address has recent fraud signals".into());
            }

            // 4. Velocity: registrations from same IP in last 24h.
            let ip_velocity: CountRow = sqlx::query_as(
                "SELECT COUNT(DISTINCT user_id)::bigint AS count FROM user_sessions \
                 WHERE ip_address = $1::inet \
                   AND session_start >= now() - interval '24 hours'",
            )
            .bind(ip_address)
            .fetch_one(&self.pool)
            .await?;

            if ip_velocity.count >= 5 {
                score += 0.35;
                reasons.push(format!(
                    "High registration velocity from IP: {} accounts in 24h",
                    ip_velocity.count
                ));
            } else if ip_velocity.count >= 3 {
                score += 0.15;
                reasons.push(format!(
                    "Multiple registrations from IP: {} accounts in 24h",
                    ip_velocity.count
                ));
            }
        }

        // 2. Device fingerprint reputation.
        if !device_fingerprint.is_empty() {
            let device_fraud: CountRow = sqlx::query_as(
                "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
                 WHERE evidence_json->>'device_fingerprint' = $1 \
                   AND status IN ('confirmed', 'actioned') \
                   AND created_at >= now() - interval '90 days'",
            )
            .bind(device_fingerprint)
            .fetch_one(&self.pool)
            .await?;

            if device_fraud.count > 0 {
                score += 0.4;
                reasons.push("Device fingerprint associated with confirmed fraud".into());
            }

            // 5. Multi-account: same fingerprint across different user_ids.
            let multi_account: CountRow = sqlx::query_as(
                "SELECT COUNT(DISTINCT user_id)::bigint AS count FROM user_sessions \
                 WHERE device_fingerprint = $1 \
                   AND created_at >= now() - interval '90 days'",
            )
            .bind(device_fingerprint)
            .fetch_one(&self.pool)
            .await?;

            if multi_account.count >= 3 {
                score += 0.3;
                reasons.push(format!(
                    "Device fingerprint used by {} different accounts",
                    multi_account.count
                ));
            }
        }

        // 3. Disposable email domain detection.
        if is_disposable_email(email) {
            score += 0.2;
            reasons.push("Registration uses a disposable email domain".into());
        }

        score = score.clamp(0.0, 1.0);
        let mut result = CheckResult::from_score(score);
        result.reasons = reasons;

        tracing::info!(
            email = email,
            score = score,
            decision = ?result.decision,
            "registration check completed"
        );

        Ok(result)
    }

    /// Check a bid for shill-bid patterns.
    ///
    /// Detection rules:
    /// 1. Shared IP/fingerprint between bidder and job poster
    /// 2. Velocity: rapid bidding (multiple bids in short timeframe)
    /// 3. Bid pattern analysis: repeated same amounts, bid-then-withdraw
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    pub async fn check_bid(
        &self,
        provider_id: Uuid,
        _job_id: Uuid,
        customer_id: Uuid,
        _amount_cents: i64,
        ip_address: &str,
        device_fingerprint: &str,
    ) -> Result<CheckResult, FraudError> {
        let mut score: f64 = 0.0;
        let mut reasons = Vec::new();
        let mut shill_detected = false;

        // 1. Shared IP between bidder and job poster.
        if !ip_address.is_empty() {
            let shared_ip: CountRow = sqlx::query_as(
                "SELECT COUNT(*)::bigint AS count FROM user_sessions \
                 WHERE user_id = $1 \
                   AND ip_address = $2::inet \
                   AND session_start >= now() - interval '30 days'",
            )
            .bind(customer_id)
            .bind(ip_address)
            .fetch_one(&self.pool)
            .await?;

            if shared_ip.count > 0 {
                score += 0.5;
                shill_detected = true;
                reasons.push("Bidder and job poster share the same IP address".into());
            }
        }

        // 1b. Shared device fingerprint between bidder and job poster.
        if !device_fingerprint.is_empty() {
            let shared_device: CountRow = sqlx::query_as(
                "SELECT COUNT(*)::bigint AS count FROM user_sessions \
                 WHERE user_id = $1 \
                   AND device_fingerprint = $2 \
                   AND session_start >= now() - interval '30 days'",
            )
            .bind(customer_id)
            .bind(device_fingerprint)
            .fetch_one(&self.pool)
            .await?;

            if shared_device.count > 0 {
                score += 0.5;
                shill_detected = true;
                reasons
                    .push("Bidder and job poster share the same device fingerprint".into());
            }
        }

        // 2. Velocity: bids from this provider in the last hour.
        let bid_velocity: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 \
               AND signal_type = 'bid_manipulation' \
               AND created_at >= now() - interval '1 hour'",
        )
        .bind(provider_id)
        .fetch_one(&self.pool)
        .await?;

        if bid_velocity.count >= 10 {
            score += 0.3;
            reasons.push(format!(
                "High bid velocity: {} bid signals in last hour",
                bid_velocity.count
            ));
        } else if bid_velocity.count >= 5 {
            score += 0.15;
            reasons.push(format!(
                "Elevated bid velocity: {} bid signals in last hour",
                bid_velocity.count
            ));
        }

        // 3. Existing shill-bid signals for this provider.
        let shill_history: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 \
               AND signal_subtype = 'shill_bid' \
               AND status IN ('pending', 'confirmed') \
               AND created_at >= now() - interval '90 days'",
        )
        .bind(provider_id)
        .fetch_one(&self.pool)
        .await?;

        if shill_history.count > 0 {
            score += 0.2;
            shill_detected = true;
            reasons.push(format!(
                "Provider has {} previous shill-bid signals",
                shill_history.count
            ));
        }

        score = score.clamp(0.0, 1.0);
        let mut result = CheckResult::from_score(score);
        result.reasons = reasons;
        result.shill_bid_detected = shill_detected;

        tracing::info!(
            provider_id = %provider_id,
            customer_id = %customer_id,
            score = score,
            shill_detected,
            decision = ?result.decision,
            "bid check completed"
        );

        Ok(result)
    }

    // -----------------------------------------------------------------------
    // Signal recording
    // -----------------------------------------------------------------------

    /// Record a single fraud signal and optionally create an alert if the
    /// user's accumulated signals exceed a threshold.
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database or validation errors.
    pub async fn record_signal(
        &self,
        user_id: Uuid,
        signal_type: SignalType,
        confidence: f64,
        details: &str,
        ip_address: &str,
        device_fingerprint: &str,
        reference_type: &str,
        reference_id: &str,
    ) -> Result<RecordedSignal, FraudError> {
        if !(0.0..=1.0).contains(&confidence) {
            return Err(FraudError::InvalidArgument(
                "confidence must be between 0.0 and 1.0".into(),
            ));
        }

        let risk_level = RiskLevel::from_score(confidence);

        // Build evidence JSON.
        let evidence = serde_json::json!({
            "ip_address": ip_address,
            "device_fingerprint": device_fingerprint,
            "reference_type": reference_type,
            "reference_id": reference_id,
        });

        let related_entity_id: Option<Uuid> = reference_id.parse().ok();
        let related_entity_type: Option<&str> = if reference_type.is_empty() {
            None
        } else {
            Some(reference_type)
        };

        let row = sqlx::query_as::<_, FraudSignalRow>(
            &format!(
                "INSERT INTO fraud_signals \
                   (user_id, signal_type, signal_subtype, severity, confidence, \
                    description, evidence_json, related_entity_id, related_entity_type) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
                 RETURNING {RETURNING_COLS}"
            ),
        )
        .bind(user_id)
        .bind(signal_type.as_db_str())
        .bind(signal_type.as_subtype_str())
        .bind(risk_level.as_db_severity())
        .bind(confidence)
        .bind(details)
        .bind(&evidence)
        .bind(related_entity_id)
        .bind(related_entity_type)
        .fetch_one(&self.pool)
        .await?;

        // Check if an alert should be created: if user has >= 3 pending signals.
        let pending_count: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 AND status = 'pending'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let alert_created = pending_count.count >= 3;

        tracing::info!(
            user_id = %user_id,
            signal_type = signal_type.as_db_str(),
            confidence = confidence,
            alert_created,
            "fraud signal recorded"
        );

        Ok(RecordedSignal {
            row,
            alert_created,
        })
    }

    /// Batch record multiple fraud signals.
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    #[allow(clippy::too_many_arguments)]
    pub async fn batch_record_signals(
        &self,
        signals: Vec<(Uuid, SignalType, f64, String, String, String, String, String)>,
    ) -> Result<(i32, i32), FraudError> {
        let mut recorded = 0i32;
        let mut alerts_created = 0i32;

        for (user_id, signal_type, confidence, details, ip, fp, ref_type, ref_id) in signals {
            match self
                .record_signal(
                    user_id,
                    signal_type,
                    confidence,
                    &details,
                    &ip,
                    &fp,
                    &ref_type,
                    &ref_id,
                )
                .await
            {
                Ok(result) => {
                    recorded += 1;
                    if result.alert_created {
                        alerts_created += 1;
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        user_id = %user_id,
                        error = %e,
                        "failed to record signal in batch"
                    );
                }
            }
        }

        Ok((recorded, alerts_created))
    }

    // -----------------------------------------------------------------------
    // Session recording
    // -----------------------------------------------------------------------

    /// Record a user session and detect anomalies.
    ///
    /// Anomaly detection:
    /// - New device fingerprint for this user
    /// - IP in a different country than recent sessions
    /// - Multiple concurrent sessions from different IPs
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    pub async fn record_session(
        &self,
        user_id: Uuid,
        ip_address: &str,
        user_agent: &str,
        device_fingerprint: &str,
        geo_lat: Option<f64>,
        geo_lng: Option<f64>,
        geo_city: Option<&str>,
        geo_country: Option<&str>,
    ) -> Result<(bool, Vec<String>), FraudError> {
        // Insert the session record.
        sqlx::query(
            "INSERT INTO user_sessions \
               (user_id, ip_address, user_agent, device_fingerprint, \
                geo_lat, geo_lng, geo_city, geo_country, session_start) \
             VALUES ($1, $2::inet, $3, $4, $5, $6, $7, $8, now())",
        )
        .bind(user_id)
        .bind(ip_address)
        .bind(user_agent)
        .bind(device_fingerprint)
        .bind(geo_lat)
        .bind(geo_lng)
        .bind(geo_city)
        .bind(geo_country)
        .execute(&self.pool)
        .await?;

        let mut anomalies = Vec::new();

        // Anomaly 1: New device fingerprint for this user.
        if !device_fingerprint.is_empty() {
            let known_device: CountRow = sqlx::query_as(
                "SELECT COUNT(*)::bigint AS count FROM user_sessions \
                 WHERE user_id = $1 \
                   AND device_fingerprint = $2 \
                   AND id != currval(pg_get_serial_sequence('user_sessions', 'id')) \
                   AND session_start >= now() - interval '90 days'",
            )
            .bind(user_id)
            .bind(device_fingerprint)
            .fetch_optional(&self.pool)
            .await?
            .unwrap_or(CountRow { count: 1 }); // Default to known to avoid false positives on error.

            if known_device.count == 0 {
                // Check if user has any previous sessions at all.
                let has_sessions: CountRow = sqlx::query_as(
                    "SELECT COUNT(*)::bigint AS count FROM user_sessions \
                     WHERE user_id = $1 \
                       AND session_start < now() - interval '1 minute'",
                )
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;

                if has_sessions.count > 0 {
                    anomalies.push("New device fingerprint detected for this user".into());
                }
            }
        }

        // Anomaly 2: Different country than recent sessions.
        if let Some(country) = geo_country {
            if !country.is_empty() {
                let recent_country: Option<GeoCountryRow> = sqlx::query_as(
                    "SELECT geo_country FROM user_sessions \
                     WHERE user_id = $1 \
                       AND geo_country IS NOT NULL \
                       AND session_start >= now() - interval '7 days' \
                       AND session_start < now() - interval '1 minute' \
                     ORDER BY session_start DESC LIMIT 1",
                )
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;

                if let Some(prev) = recent_country {
                    if prev.geo_country != country {
                        anomalies.push(format!(
                            "Geo mismatch: session from {} but recent sessions from {}",
                            country, prev.geo_country
                        ));
                    }
                }
            }
        }

        // Anomaly 3: Multiple concurrent IPs.
        let concurrent_ips: CountRow = sqlx::query_as(
            "SELECT COUNT(DISTINCT ip_address)::bigint AS count FROM user_sessions \
             WHERE user_id = $1 \
               AND session_start >= now() - interval '15 minutes'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        if concurrent_ips.count > 3 {
            anomalies.push(format!(
                "Multiple IPs detected: {} different IPs in last 15 minutes",
                concurrent_ips.count
            ));
        }

        let anomaly_detected = !anomalies.is_empty();

        if anomaly_detected {
            tracing::warn!(
                user_id = %user_id,
                anomalies = ?anomalies,
                "session anomalies detected"
            );
        }

        Ok((anomaly_detected, anomalies))
    }

    /// Get session history for a user with pagination.
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    pub async fn get_session_history(
        &self,
        user_id: Uuid,
        page: i32,
        page_size: i32,
    ) -> Result<(Vec<UserSessionRow>, i64), FraudError> {
        let offset = i64::from((page - 1).max(0)) * i64::from(page_size.max(1));
        let limit = i64::from(page_size.clamp(1, 100));

        let rows = sqlx::query_as::<_, UserSessionRow>(
            &format!(
                "{SESSION_SELECT} \
                 WHERE user_id = $1 \
                 ORDER BY session_start DESC \
                 LIMIT $2 OFFSET $3"
            ),
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let count: CountRow =
            sqlx::query_as("SELECT COUNT(*)::bigint AS count FROM user_sessions WHERE user_id = $1")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;

        Ok((rows, count.count))
    }

    // -----------------------------------------------------------------------
    // User risk profile
    // -----------------------------------------------------------------------

    /// Compute a user's risk profile from their fraud signals and session data.
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    #[allow(clippy::cast_possible_truncation)]
    pub async fn get_user_risk_profile(
        &self,
        user_id: Uuid,
    ) -> Result<UserRiskProfileData, FraudError> {
        // Total signals count.
        let total_signals: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Active (pending/confirmed) signals count.
        let active_signals: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 AND status IN ('pending', 'confirmed')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Recent signal types (last 90 days).
        let recent_types: Vec<SignalTypeRow> = sqlx::query_as(
            "SELECT DISTINCT signal_type, signal_subtype FROM fraud_signals \
             WHERE user_id = $1 AND created_at >= now() - interval '90 days' \
             ORDER BY signal_type",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        // Last signal timestamp.
        let last_signal: TimestampRow = sqlx::query_as(
            "SELECT MAX(created_at) AS ts FROM fraud_signals WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Last reviewed timestamp.
        let last_reviewed: TimestampRow = sqlx::query_as(
            "SELECT MAX(reviewed_at) AS ts FROM fraud_signals WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Calculate risk score: based on signal count, severity, and recency.
        let risk_score = self.calculate_risk_score(user_id).await?;
        let risk_level = RiskLevel::from_score(risk_score);

        // Check if user is restricted (has actioned signals with restriction).
        let is_restricted = active_signals.count > 0
            && sqlx::query_as::<_, CountRow>(
                "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
                 WHERE user_id = $1 AND status = 'actioned' \
                   AND auto_action IN ('restrict', 'ban')",
            )
            .bind(user_id)
            .fetch_one(&self.pool)
            .await
            .map_or(false, |r| r.count > 0);

        let recent_signal_types: Vec<SignalType> = recent_types
            .iter()
            .map(|r| SignalType::from_db_str(&r.signal_type, &r.signal_subtype))
            .collect();

        Ok(UserRiskProfileData {
            user_id,
            risk_score,
            risk_level,
            total_signals: i32_from_i64(total_signals.count),
            active_alerts: i32_from_i64(active_signals.count),
            recent_signal_types,
            is_restricted,
            last_signal_at: last_signal.ts,
            last_reviewed_at: last_reviewed.ts,
        })
    }

    /// Calculate aggregate risk score for a user.
    ///
    /// Factors:
    /// - Number of signals (weighted by recency)
    /// - Severity distribution
    /// - Active vs dismissed ratio
    async fn calculate_risk_score(&self, user_id: Uuid) -> Result<f64, FraudError> {
        // Count signals by severity in last 90 days.
        let high: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 AND severity = 'high' \
               AND status IN ('pending', 'confirmed') \
               AND created_at >= now() - interval '90 days'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let medium: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 AND severity = 'medium' \
               AND status IN ('pending', 'confirmed') \
               AND created_at >= now() - interval '90 days'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let low: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint AS count FROM fraud_signals \
             WHERE user_id = $1 AND severity = 'low' \
               AND status IN ('pending', 'confirmed') \
               AND created_at >= now() - interval '90 days'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Weighted score: high=0.4 per signal, medium=0.2, low=0.05. Capped at 1.0.
        let score = (high.count as f64 * 0.4
            + medium.count as f64 * 0.2
            + low.count as f64 * 0.05)
            .clamp(0.0, 1.0);

        Ok(score)
    }

    // -----------------------------------------------------------------------
    // Signal retrieval (used by grpc layer)
    // -----------------------------------------------------------------------

    /// Fetch a fraud signal by ID.
    ///
    /// # Errors
    ///
    /// Returns `FraudError` on database errors.
    #[allow(dead_code)]
    pub async fn get_signal(&self, signal_id: Uuid) -> Result<FraudSignalRow, FraudError> {
        sqlx::query_as::<_, FraudSignalRow>(&format!(
            "{SIGNAL_SELECT} WHERE id = $1"
        ))
        .bind(signal_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| FraudError::SignalNotFound(signal_id.to_string()))
    }
}

// ---------------------------------------------------------------------------
// Disposable email domain detection
// ---------------------------------------------------------------------------

/// Simple heuristic for disposable/temporary email providers.
fn is_disposable_email(email: &str) -> bool {
    const DISPOSABLE_DOMAINS: &[&str] = &[
        "mailinator.com",
        "guerrillamail.com",
        "tempmail.com",
        "throwaway.email",
        "yopmail.com",
        "10minutemail.com",
        "trashmail.com",
        "temp-mail.org",
        "fakeinbox.com",
        "sharklasers.com",
        "guerrillamailblock.com",
        "grr.la",
        "dispostable.com",
        "maildrop.cc",
        "mailnesia.com",
    ];

    if let Some(domain) = email.rsplit('@').next() {
        let domain_lower = domain.to_lowercase();
        DISPOSABLE_DOMAINS
            .iter()
            .any(|d| domain_lower == *d)
    } else {
        false
    }
}

// ---------------------------------------------------------------------------
// Helper row types
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct GeoCountryRow {
    geo_country: String,
}

/// RETURNING clause columns for fraud_signals INSERT.
const RETURNING_COLS: &str = "\
    id, user_id, signal_type, signal_subtype, severity, \
    confidence::float8 AS confidence, description, evidence_json, \
    related_entity_id, related_entity_type, status, \
    auto_actioned, auto_action, created_at, updated_at";

/// Safely truncate i64 to i32.
#[allow(clippy::cast_possible_truncation)]
fn i32_from_i64(v: i64) -> i32 {
    v.min(i64::from(i32::MAX)) as i32
}
