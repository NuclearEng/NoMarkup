# Runbook: Fraud False Positive — Manual Override

> A legitimate user (provider or customer) has been auto-flagged or
> auto-suspended by the fraud engine. They cannot bid, post jobs, withdraw
> funds, or log in. Restore access without compromising the fraud signals.

## Symptoms

- Customer/provider support ticket: "I was told my account is restricted"
  / "Why can't I log in?" / "My bid was rejected as suspicious."
- Fraud admin queue (`/admin/fraud/alerts`) shows a HIGH severity flag for
  the user with confidence score < 0.75 (the manual review band per FR-12.3).
- Logs (fraud engine):
  ```
  fraud: HIGH risk for user_id=<uuid>, score=0.82, signals=[velocity, geo_mismatch]
  ```
- The user's `users.status` may be `suspended` or their bids may be
  silently dropped at the gateway.

## Diagnosis

1. **Pull the fraud signal trail:**
   ```bash
   curl -s -H "Authorization: Bearer <admin-token>" \
     https://nomarkup.com/api/v1/admin/fraud/users/<user_id>/risk | jq .
   ```
   Returns:
   ```json
   {
     "user_id": "...",
     "score": 0.82,
     "signals": [
       {"name": "velocity_bids_5min", "value": 12, "threshold": 8, "weight": 0.3},
       {"name": "geo_mismatch_ip_vs_billing", "value": 1, "threshold": 1, "weight": 0.4},
       ...
     ],
     "history": [...]
   }
   ```
2. **Assess the signals as a human:**
   - `velocity_*` — could be legitimate (e.g., user clearing a backlog).
   - `geo_mismatch_*` — VPN, travel, mobile carrier IP. Often false positive.
   - `fingerprint_entropy_low` — privacy-mode browser, ad blocker. Common false positive.
   - `multi_account_email_pattern` — strong signal; verify carefully.
   - `device_shared_with_banned_user` — strong signal; do not override without escalation.

3. **Check the user's history:**
   ```sql
   SELECT id, role, status, created_at, last_active_at, kyc_verified_at
     FROM users WHERE id = '<uuid>';
   SELECT count(*) FROM bids WHERE provider_id = '<uuid>';
   SELECT count(*) FROM contracts WHERE customer_id = '<uuid>' OR provider_id = '<uuid>';
   SELECT count(*) FROM disputes WHERE filed_against_user_id = '<uuid>';
   ```
   A user with KYC-verified status, no past disputes, and 50+ completed jobs
   has earned the benefit of the doubt.

## Mitigation

### Path A: Manual override (false positive confirmed)

**Authority:** Trust & Safety lead OR senior support agent. Log every override
in the admin audit trail.

1. Reactivate the user (if suspended):
   ```bash
   curl -X POST https://nomarkup.com/api/v1/admin/users/<user_id>/reactivate \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"reason": "fraud_false_positive", "reviewer_notes": "Reviewed signals; user has 50+ completed jobs, 0 disputes, KYC verified. Geo mismatch explained by carrier IP."}'
   ```
2. Mark the fraud alert as resolved with a false-positive label:
   ```bash
   curl -X POST https://nomarkup.com/api/v1/admin/fraud/alerts/<alert_id>/review \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"outcome": "false_positive", "notes": "..."}'
   ```
3. Add a temporary boost to the user's trust signal (decays over 30 days):
   ```sql
   INSERT INTO trust_overrides (user_id, dimension, value, expires_at, reason, reviewer_id)
   VALUES ('<uuid>', 'fraud', 0.0, now() + interval '30 days',
           'manual_false_positive_override', '<admin_uuid>');
   ```
4. Notify the user via in-app + email:
   - Template: `account_reactivated_fp`.
   - Apologize, do not reveal which signals triggered the flag.

### Path B: Genuine risk but low confidence — request more KYC

1. Send the user a verification challenge:
   ```bash
   curl -X POST https://nomarkup.com/api/v1/admin/users/<user_id>/request-kyc \
     -H "Authorization: Bearer <admin-token>" \
     -d '{"required_docs": ["government_id", "selfie_match"]}'
   ```
2. Keep the account in `restricted` state until docs are submitted.
3. On submission, T&S reviews and decides Path A (clear) or Path C (uphold).

### Path C: Uphold the flag

1. Do NOT reactivate. Keep `users.status = 'suspended'` (or `banned` if Path E warranted).
2. Send the user a transparent decline notice (template `account_restricted_appeal_path`) with the appeal channel.
3. Open a Trust & Safety ticket for tracking.

### Path D: Engine misbehaving (many false positives at once)

If multiple users complain in a short window, the engine may have a
mis-tuned threshold or a bad rule deploy:

1. Check fraud engine version in pod label:
   ```bash
   kubectl get pods -n nomarkup -l app.kubernetes.io/name=fraud -o jsonpath='{.items[0].spec.containers[0].image}'
   ```
2. Roll back if recent:
   ```bash
   kubectl rollout undo -n nomarkup deployment/fraud
   ```
3. Lower the auto-suspend threshold via feature flag:
   ```bash
   curl -X PUT https://nomarkup.com/api/v1/admin/flags/fraud_auto_suspend_threshold \
     -H "Authorization: Bearer <admin-token>" \
     -d '{"value": 0.95}'    # was 0.75 — now requires near-certainty
   ```
4. Bulk-review the queue:
   ```sql
   SELECT user_id, score, created_at
     FROM fraud_alerts
    WHERE created_at > now() - interval '6 hours' AND outcome IS NULL
    ORDER BY score DESC;
   ```

### Path E: Genuine fraud confirmed (escalate, do not override)

See `docs/operations/incident-response.md` → "Confirmed fraud" path.
Do NOT use this runbook. The user is correctly suspended.

## Resolution

1. User can log in / bid / withdraw (test with their support agent watching).
2. Fraud alert closed with appropriate outcome label.
3. Trust override row exists if Path A was used.
4. User received a notification.
5. If Path D was used: revert flag once the bad rule is fixed.

## Postmortem Template (only required if Path D — bulk false positives)

```
## Incident: Fraud Engine False Positive Spike YYYY-MM-DD
- Affected users: <count> (suspended) + <count> (rejected bids)
- Trigger: <rule deploy / threshold change / data drift>
- Detection: <support tickets / alert / proactive monitoring>
- Time to mitigation: HH:MM

### Action items
- [ ] Add canary deploy for fraud rule changes (1% traffic, monitor FP rate)
- [ ] Add false-positive-rate metric: fraud_alerts_false_positive_total / fraud_alerts_total
- [ ] Notify suspended users of recovery via mass email
```
