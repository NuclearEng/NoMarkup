# GDPR / CCPA Account Deletion

> Status: **PARTIAL**. Architecture for soft-delete (deactivation) exists.
> Hard-delete pipeline that anonymizes child rows, deletes Stripe Connect
> account, revokes OAuth tokens, and erases PII end-to-end is **NOT YET
> WIRED** — see *Gap* section.

## Regulatory Position

- **GDPR** (EU residents): right to erasure under Article 17. Must respond
  within 30 days of verified request.
- **CCPA / CPRA** (California): right to delete personal information. 45
  days, extendable to 90.
- **PIPEDA** (Canada): right of access and correction; deletion not absolute
  but expected for closed accounts after data is no longer needed.

## Current Implementation (what's wired today)

### 1. Account deactivation (soft delete)

The user service has the proto RPC `DeactivateAccount` defined
(`proto/user/v1/user.proto`) and the corresponding domain status
`USER_STATUS_DEACTIVATED` is enforced at login (`services/user/internal/service/auth.go:112`).

**Behavior when a user is in `deactivated` state:**
- Login is rejected with `ErrAccountDeactivated`.
- Other users see "deactivated user" placeholder for the display name and avatar.
- The row in `users` is preserved.
- Bids, jobs, contracts, and reviews authored by the user remain visible
  (anonymized at the read path).

This satisfies the *closed account* expectation but **does not satisfy GDPR
erasure** because:
- Email and phone are still stored in plaintext (encrypted at rest, but tied
  to the original identity).
- KYC documents, payment method tokens, and Stripe customer ID remain.
- Chat messages still carry the user_id.

### 2. PII inventory (where the data lives)

| Table / store               | PII fields                                     | Strategy on full erasure |
|-----------------------------|------------------------------------------------|--------------------------|
| `users`                     | email, phone, display_name, avatar_url         | Replace with hashed tombstone |
| `user_profiles`             | bio, social_links                              | NULL                     |
| `provider_profiles`         | business_name, license_numbers, photos, hours  | NULL + portfolio S3 delete |
| `verification_documents`    | S3 keys for ID / insurance scans               | Delete S3 objects + row  |
| `properties`                | address, lat/lng, photos                       | Anonymize address + delete photos |
| `jobs`                      | description, photos, customer_id               | Reassign to "deleted_user" sentinel; keep public job row for transparency |
| `bids`                      | provider_id                                    | Reassign to sentinel     |
| `contracts`                 | customer_id, provider_id                       | Reassign to sentinel; preserve dispute record |
| `reviews`                   | reviewer_id, reviewee_id, body                 | Reassign reviewer; keep body (legitimate interest, public review) |
| `chat_messages`             | user_id, body                                  | Reassign user_id; redact body if requested |
| `notifications`             | user_id, payload                               | Delete                   |
| `payment_methods`           | stripe_customer_id, last4                      | Delete + Stripe customer.delete |
| `stripe_connect_accounts`   | stripe_account_id                              | Reject delete if balance > 0; queue for after payout; otherwise account.del |
| `oauth_tokens`              | google_token, apple_token                      | Delete + revoke at provider |
| `sessions`                  | refresh_token_hash                             | Delete                   |
| `audit_log`                 | user_id, ip                                    | KEEP (legal retention, anonymize actor field after 90 days) |
| `fraud_alerts`              | user_id, signals                               | KEEP (legitimate interest, anonymize after 1 year) |
| Sentry events               | user.id, user.email                            | Forward delete to Sentry API |
| Mixpanel / analytics        | distinct_id                                    | Forward delete to provider |
| S3 buckets                  | profile photos, portfolio, completion photos   | Delete by prefix         |
| Search index (Meilisearch)  | provider listing fields                        | Delete document          |

### 3. Currently exposed endpoints

- `POST /api/v1/users/me/roles` — manage roles (not delete).
- *(planned)* `DELETE /api/v1/users/me` — not yet routed.

The proto RPC `DeactivateAccount` is **defined but not exposed via HTTP**
in the gateway. There is no admin tool, no self-service flow, and no
internal cron that processes deletion requests. **All current "deletes"
go through admin actions on a per-row basis.**

## Gap

To meet GDPR, we need:

1. A self-service request: `DELETE /api/v1/users/me` (or `POST /api/v1/me/delete-request`).
2. A 30-day grace period implemented as `users.delete_requested_at` so the user
   can rescind by logging in again (email containing one-click cancel link).
3. A cron job (e.g. `cmd/gdpr-eraser`) that, when `delete_requested_at` is older
   than 30 days, executes the table-by-table erasure plan above in a single
   transaction wherever feasible.
4. Stripe customer / connect account deletion, with the rule that we do NOT
   delete a Connect account that still has unpaid balance — instead, queue
   for retry after final payout.
5. OAuth token revocation with each provider's revoke endpoint.
6. S3 prefix deletion for the user's media.
7. Sentry / analytics deletion API calls.
8. Confirmation email at request time AND at completion time.
9. Audit log entry that records "GDPR-erased" with a hash of the original
   user_id (so we can prove the request was honored without retaining the PII).
10. Admin override for "reject deletion" (legal hold) with documented reason.

## Self-service flow (target)

```
User clicks "Delete my account" in Settings
  → DELETE /api/v1/users/me
    - Auth required
    - Sets users.delete_requested_at = now()
    - Sets users.status = 'pending_deletion'
    - Sends email "We received your request" with cancel link valid 30 days
    - Logs out all sessions

User clicks cancel link within 30 days
  → POST /api/v1/auth/cancel-deletion?token=...
    - Clears delete_requested_at
    - Restores users.status = 'active'
    - Sends email "Account restored"

Cron runs daily (gdpr_eraser):
  → For each user where delete_requested_at < now() - interval '30 days':
    1. Begin tx.
    2. Execute table plan above.
    3. Stripe.customers.del(stripe_customer_id).
    4. Stripe.accounts.del(stripe_account_id) if balance == 0; else mark for post-payout retry.
    5. OAuth revoke.
    6. S3 delete by prefix.
    7. Sentry / analytics delete API calls.
    8. INSERT audit_log row with hashed user_id.
    9. DELETE FROM users WHERE id = $1 (after all FKs anonymized).
    10. Commit.
    11. Send email "Your account has been deleted" (last contact).
```

## Manual procedure (today, while pipeline is unbuilt)

To honor a verified GDPR request before the pipeline is built:

1. Verify identity via existing email + a manual check (out-of-band).
2. Run, in production psql (with two-engineer review):
   ```sql
   BEGIN;

   -- Capture for audit
   INSERT INTO audit_log (id, actor_user_id, action, target_user_id, payload, created_at)
   VALUES (gen_random_uuid(), '<admin_uuid>', 'gdpr_erase_manual', '<user_uuid>',
           jsonb_build_object('verified_via','email','operator','<your_name>'), now());

   -- Anonymize FKs that can keep their rows
   UPDATE jobs SET customer_id = '00000000-0000-0000-0000-000000000000' WHERE customer_id = '<user_uuid>';
   UPDATE bids SET provider_id = '00000000-0000-0000-0000-000000000000' WHERE provider_id = '<user_uuid>';
   UPDATE contracts SET customer_id = '00000000-0000-0000-0000-000000000000' WHERE customer_id = '<user_uuid>';
   UPDATE contracts SET provider_id = '00000000-0000-0000-0000-000000000000' WHERE provider_id = '<user_uuid>';
   UPDATE reviews SET reviewer_id = '00000000-0000-0000-0000-000000000000' WHERE reviewer_id = '<user_uuid>';
   UPDATE chat_messages SET user_id = '00000000-0000-0000-0000-000000000000', body = '[deleted]' WHERE user_id = '<user_uuid>';

   -- Delete PII rows
   DELETE FROM verification_documents WHERE user_id = '<user_uuid>';
   DELETE FROM properties WHERE user_id = '<user_uuid>';
   DELETE FROM payment_methods WHERE user_id = '<user_uuid>';
   DELETE FROM oauth_tokens WHERE user_id = '<user_uuid>';
   DELETE FROM sessions WHERE user_id = '<user_uuid>';
   DELETE FROM notifications WHERE user_id = '<user_uuid>';
   DELETE FROM provider_profiles WHERE user_id = '<user_uuid>';
   DELETE FROM user_profiles WHERE user_id = '<user_uuid>';

   -- Finally, the user row
   DELETE FROM users WHERE id = '<user_uuid>';

   COMMIT;
   ```
3. **Externally:**
   - In Stripe Dashboard → Customers → search → click → Actions → Delete.
   - In Stripe Connect → Accounts → search → click → Disable / delete (must have $0 balance).
   - In Sentry → Settings → Privacy → Delete user data → submit user_id.
   - In Mixpanel / analytics → Delete user via API.
   - S3: `aws s3 rm s3://nomarkup-prod/users/<user_uuid>/ --recursive`
4. Log the manual procedure in the legal-hold spreadsheet with timestamp and operator.

## Verification

After the pipeline is built, the canonical test is:

```bash
# Create test user via API
curl -X POST .../auth/register -d '{"email":"gdpr-test+1@nomarkup.com","password":"..."}'

# Trigger deletion
curl -X DELETE .../users/me -H "Authorization: Bearer <token>"

# Wait 30 days (or fast-forward delete_requested_at in dev)

# Run cron
go run ./cmd/gdpr-eraser

# Confirm:
SELECT count(*) FROM users WHERE id = '<test_user_uuid>';                  -- 0
SELECT count(*) FROM payment_methods WHERE user_id = '<test_user_uuid>';   -- 0
SELECT count(*) FROM verification_documents WHERE user_id = '<test_user_uuid>'; -- 0
# Stripe customer no longer retrievable.
# S3 prefix empty.
# Sentry confirms deletion.
```

## Owner

Until the GDPR pipeline ships:
- **Policy owner:** Legal.
- **Implementation owner:** User Service team (open ticket NMK-GDPR-1).
- **Manual fulfillment owner:** Trust & Safety (max 2 / week — beyond that
  becomes infeasible without the pipeline).
