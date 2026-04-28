# GDPR / CCPA Account Deletion

> Status: **IMPLEMENTED** as of migration 032 + user-service `Erasure`
> service. Self-service request, 30-day grace period, automated cron
> finalize, admin override, full PII cascade. See architecture and
> verification sections below.

## Regulatory Position

- **GDPR** (EU residents): right to erasure under Article 17. Must respond
  within 30 days of verified request.
- **CCPA / CPRA** (California): right to delete personal information. 45
  days, extendable to 90.
- **PIPEDA** (Canada): right of access and correction; deletion not absolute
  but expected for closed accounts after data is no longer needed.

We pick **30 days** as the grace window (the shorter of the two — safer for
the regulator and a clearer UX promise than juggling per-jurisdiction
windows). The constant lives at
`services/user/internal/domain.DeletionGracePeriod`.

## Architecture

```
       ┌─────────────────────────────────┐
       │  Web (settings/account/page.tsx)│
       │   - Type DELETE, pick reason    │
       └──────────────┬──────────────────┘
                      │ DELETE /api/v1/users/me
                      │ POST   /api/v1/users/me/restore
                      ▼
       ┌─────────────────────────────────┐
       │       Gateway (Go / Chi)        │
       │   handler/user.go               │
       └──────────────┬──────────────────┘
                      │ gRPC
                      ▼
       ┌─────────────────────────────────┐
       │  User Service / service.Erasure │
       │   • RequestAccountDeletion      │
       │   • CancelAccountDeletion       │
       │   • FinalizeAccountDeletion     │
       │   • ProcessPendingFinalizations │   ← cron entrypoint
       └──────────────┬──────────────────┘
                      │
        ┌─────────────┼─────────────┬──────────────┐
        ▼             ▼             ▼              ▼
   ┌────────┐   ┌──────────────┐ ┌────────┐  ┌────────┐
   │Postgres│   │PaymentService│ │   S3   │  │ OAuth  │
   │ cascade│   │/DeleteStripe-│ │ prefix │  │ revoke │
   │ (1 tx) │   │   Accounts   │ │ delete │  │        │
   │        │   │  (gRPC)      │ │        │  │        │
   └────────┘   └──────┬───────┘ └────────┘  └────────┘
                      │
                      ▼
                ┌──────────────┐
                │ Stripe API   │
                │ customer.Del │
                │ account.Del  │
                └──────────────┘
```

## Lifecycle

1. **User requests deletion** — `DELETE /api/v1/users/me` with
   `{reason, confirmation: "DELETE"}`. Service sets
   `users.deletion_requested_at = now()` and `users.deletion_reason`.
   Returns the grace deadline (request_time + 30 days). Sends a
   confirmation email (currently a TODO stub — log only).
2. **Grace window (30 days)** — the user can sign in and call
   `POST /api/v1/users/me/restore` to clear the request. Login is NOT
   blocked during this window (so users can rescind).
3. **Cron worker fires** every 6 hours (`startGDPRWorker` in
   `services/user/cmd/server/gdpr_worker.go`) and queries
   `users WHERE deletion_requested_at < NOW() - INTERVAL '30 days' AND
   deletion_finalized_at IS NULL`. For each row it calls
   `FinalizeAccountDeletion` (force=false).
4. **Cascade runs** in a single Postgres transaction
   (`repository.PostgresRepository.FinalizeAccountDeletion`). After commit,
   side-effect calls fire: Stripe customer + Connect account delete, S3
   prefix delete, OAuth revoke. Each side-effect failure is logged but does
   NOT roll back the in-DB cascade — the row's `deletion_finalized_at` is
   set so the cron will not re-process it.
5. **Audit log** entry written to `admin_audit_log` with
   `action='gdpr_finalize'`, target user id, and the per-table row counts
   plus Stripe outcomes.
6. **Admin override** — `POST /api/v1/admin/users/{id}/finalize-deletion`
   bypasses the grace window for compliance / legal-hold release. Same
   audit log entry but with admin actor.

## Erasure Cascade — Decisions Per Table

| Table | Strategy | Why |
|-------|----------|-----|
| `users` | Anonymize. email → `deleted-{uuid}@deleted.local`, display_name → `Deleted User`, phone/avatar/password/MFA → NULL, status → `deactivated`, set `deletion_finalized_at`, `deleted_at`. | Keep the row so foreign keys to bids/jobs/contracts/reviews stay valid. The tombstone email is unique-friendly so the UNIQUE constraint never collides. |
| `provider_profiles` | business_name → "Deleted Provider", bio/service_address/ein_tin/insurance_policy_number/service_location → NULL. | KYC fields are PII; business_name shows up on the public marketplace. |
| `provider_employees` | first_name/last_name → "Deleted Employee", email/phone/dob/license/insurance → NULL. | These are real people other than the user — wipe them because the user can no longer steward consent. |
| `provider_portfolio_images` | DELETE rows. | Photos can be PII (faces, license plates). S3 objects are removed by the prefix-delete step. |
| `properties` | address/city/state → "[deleted]", location → (0,0), keep zip_code. | Zip is needed for market-range analytics (zip-level price index). Anything more granular is PII. |
| `verification_documents` | DELETE. | KYC scans must not survive erasure even if user later re-registers — fresh consent required. |
| `jobs` | KEEP rows (platform-public listings). description → "[deleted]", service_address → NULL. | Providers needed to see the listing publicly during the auction; fully wiping rewrites public history. We anonymize free-text just in case the customer wrote something identifying. |
| `job_photos` | DELETE rows. | Same reasoning as portfolio images. |
| `bids` | KEEP. Strip `note`/`comment`/`message` keys from `bid_updates` JSON. | Bids back the contract money trail — every awarded contract has a bid behind it. We don't drop them but redact freeform text. |
| `contracts` | KEEP. cancellation_reason → NULL when the user cancelled. | Tax / IRS / Stripe-dispute retention requires keeping the ledger. |
| `payments` | KEEP, untouched. | Legal retention requirement (IRS 7yr, Stripe 18mo). The columns the user can write to are all numeric/enum — no free-text PII to redact. |
| `reviews` | review_text → "[Deleted]". reviewer_id stays (NOT NULL FK + UNIQUE constraint with contract_id) but points at the now-anonymized user row. | Ratings have legitimate platform interest; published-review integrity for the reviewee is preserved. Comment is redacted because the reviewer wrote it about another party. |
| `review_responses` | response_text → "[Deleted]". | Same reasoning as reviews. |
| `review_flags` | DELETE where `flagged_by` or `resolved_by` = user. | Internal moderation state, no value once the user is gone. |
| `chat_messages` | content/attachment_* → NULL, is_deleted=true, deleted_at=now(). sender_id stays. | Other party in the conversation needs the channel to render; replacing content with "[Deleted]" preserves structure. |
| `refresh_tokens` | DELETE. | Belt-and-braces — the status flip to `deactivated` already blocks login but we want zero credentials surviving. |
| `user_sessions` | NULL out fingerprint_components, device_fingerprint, geo_*, user_agent. | Fraud-system retention needs the row, but the identifiers are PII. |
| `notifications` | DELETE. | Personalized; no value retained after account is gone. |
| `notification_preferences` | DELETE. | Same. |
| `device_tokens` | DELETE. | Push notification credentials. |
| `fraud_signals` | KEEP, evidence_json → NULL. user_id stays. | Compliance retention — we may need to demonstrate why a related account was banned. The evidence blob is PII (IP, fingerprints). |
| `trust_scores` | DELETE. | Computed; meaningless once account is wiped. |
| `trust_score_history` | DELETE. | Same. |
| `oauth_accounts` | DELETE. Provider-side revoke handled via `OAuthRevoker` (Google/Apple revoke endpoint where supported). | Removes the link; provider revoke is best-effort. |
| `subscriptions` | KEEP for accounting. stripe_customer_id remains so we know which Stripe customer was deleted. | Needed for accountant reconciliation. |
| `listings` | KEEP rows where the user was the seller. title/description → "[deleted]", pickup_address → NULL, location → (0,0), keep pickup_zip_code (needed for tax analytics). | Public marketplace history; bids tied to it must remain resolvable. |
| `listing_photos` | DELETE rows for affected listings. | Same reasoning as job_photos / portfolio images — photos are PII. |
| `listing_bids` | KEEP. Strip `ip_address` and `fingerprint`. | Bids back the order money trail (same reasoning as `bids`). The anti-abuse trail is PII; redact it but keep the bid amount + timestamp. |
| `listing_orders` | KEEP, untouched. | Same legal retention as `payments` — Stripe 18mo + IRS 7yr. The columns are numeric/enum (no free-text PII). |
| `listing_reports` (035) | reporter_id → NULL (FK is `ON DELETE SET NULL`, so cascade is automatic), description → "[deleted]" when authored by the user. KEEP the row otherwise — auto-hide trail must survive deletion. | Internal moderation state. Anonymizing the reporter prevents retaliation reverse-lookup; redacting free-text removes any PII the user typed. |
| `marketplace_disputes` | description → "[deleted]". KEEP all numeric / status fields. | Same reasoning as contract `disputes`: ledger integrity for resolved transfers. Free-text gets redacted. |
| `seller_tax_forms` | KEEP, untouched. | 1099-K legal retention (IRS 7yr). |
| `S3 users/{userID}/` | Delete every object. | Avatar, portfolio, KYC scans, completion photos, listing photos. |
| Stripe Customer | `stripe.Customer.del()`. | Outcome string recorded in audit log. |
| Stripe Connect Account | `stripe.Account.del()`. May be rejected if open balance — see Open Edge Cases. | Outcome recorded. |

## Stripe Deletion Adapter

The user service does NOT call Stripe directly. The payment service owns
the stripe-go SDK and exposes a single GDPR-erasure RPC:

```
PaymentService/DeleteStripeAccounts(stripe_customer_id, stripe_account_id)
  → (customer_outcome, account_outcome)
```

The user service ships a thin gRPC adapter (`stripeDeleterClient` in
`services/user/cmd/server/stripe_deleter.go`) that satisfies the
`service.StripeDeleter` interface and delegates each call to the payment
service. Wiring is via `PAYMENT_SERVICE_ADDR`:

| `PAYMENT_SERVICE_ADDR` | Behaviour |
|------------------------|-----------|
| set + reachable | Real Stripe `customer.Del` / `account.Del`, mapped outcomes below. |
| set + unreachable | Connection error logged at WARN; falls back to noop deleter (`skipped_no_client`). |
| unset | Falls back to noop deleter (`skipped_no_client`). |

### Outcome Strings (audit-log values)

The audit log records `stripe_customer_outcome` and `stripe_account_outcome`
verbatim. The payment-service classifier (`classifyStripeDeleteErr` in
`services/payment/internal/service/stripe_deleter.go`) returns one of:

| Outcome | When | Operator Action |
|---------|------|-----------------|
| `"deleted"` | Stripe accepted the delete. | None. |
| `"deleted_already_gone"` | Stripe returned 404 / `resource_missing`. | None — assume a prior partial run handled it. |
| `"skipped_no_id"` | The user had no Stripe customer / account ID at cascade time. | None. |
| `"skipped_no_client"` | User service wired with no deleter (dev / `PAYMENT_SERVICE_ADDR` unset) OR payment service in dev mode. | Re-run finalize once the deleter is wired. |
| `"skipped_open_invoices"` | Customer has open invoices — Stripe blocks deletion. | Settle invoices in Stripe dashboard, then `POST /api/v1/admin/users/{id}/finalize-deletion` to retry. |
| `"skipped_dispute"` | Customer has an active dispute. | Wait for dispute resolution, then admin re-finalize. |
| `"skipped_balance"` | Connect account has positive balance OR an active subscription. | Wait for the next payout sweep, then admin re-finalize. |
| `"error: <detail>"` | Transient/unrecognized Stripe error. | The cron will NOT pick the user up again (deletion_finalized_at is set). Operator reviews the audit log and triggers admin re-finalize. |

`"deleted"`, `"deleted_already_gone"`, and the `skipped_*` outcomes are
considered terminal — the audit row is the source of truth and no further
automatic retry happens. Only the cron's first tick after the grace window
runs the cascade; subsequent re-attempts are operator-driven via the admin
finalize endpoint.

## Open Stripe Edge Cases

- **Connect account with positive balance.** Returns
  `"skipped_balance"`. Operator-initiated retry needed once Stripe sweeps
  the balance.
- **Pending dispute on a Customer.** Returns `"skipped_dispute"`.
- **Customer with open invoices.** Returns `"skipped_open_invoices"`.
- **Connect Express vs Custom.** We use Express. Express accounts can be
  deleted via the API but the dashboard returns a 410 if the account has
  already paid out — we treat it as `"deleted"`.
- **Customer attached to a Subscription.** Cancel the subscription
  before requesting deletion. The cascade runs after the user has
  stopped using the platform; in steady state there shouldn't be active
  subscriptions on a deletion-requested account. If we see this in
  production we'll add an explicit cancel-then-delete chain in the
  payment service adapter.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `DELETE` | `/api/v1/users/me` | user | Initiate deletion (body: `{reason, confirmation: "DELETE"}`). Returns 200 + `grace_deadline`. |
| `POST` | `/api/v1/users/me/restore` | user | Cancel pending deletion. Returns `{cancelled: bool}`. |
| `POST` | `/api/v1/admin/users/{id}/finalize-deletion` | admin | Force the cascade now. |

gRPC RPCs (consumed by gateway):

- `RequestAccountDeletion(user_id, reason, confirmation)`
- `CancelAccountDeletion(user_id)`
- `FinalizeAccountDeletion(user_id, force, admin_id)`

The legacy `DeactivateAccount` RPC is preserved for the
immediate-suspend-with-password path (different lifecycle, different
intent) and is unaffected by this work.

## Database

Migration `032_gdpr_deletion.up.sql`:

- `users.deletion_requested_at TIMESTAMPTZ NULL`
- `users.deletion_reason TEXT NULL`
- `users.deletion_finalized_at TIMESTAMPTZ NULL`
- Index `idx_users_deletion_pending` on `(deletion_requested_at) WHERE
  deletion_finalized_at IS NULL` — cron's hot-path predicate.

## Cron Worker

Lives in `services/user/cmd/server/gdpr_worker.go`. Started from `main.go`
on a 6-hour ticker.

Env vars:

- `GDPR_WORKER_ENABLED=false` — skip worker (use during incidents).
- `GDPR_WORKER_INTERVAL=6h` — duration string.
- `GDPR_WORKER_BATCH_SIZE=100` — per-tick max users.

Metrics (Prometheus):

- `gdpr_deletions_finalized_total` — counter, bumps once per user.
- `gdpr_deletions_failed_total` — counter; a tick that throws will
  bump this without bumping the success counter.

Graceful shutdown: the goroutine watches `ctx.Done()`; per-tick work
runs inside Postgres transactions so a SIGTERM mid-cascade rolls back
the unfinished tx and the user shows up in the next tick. No sleep loops
without context selection.

## Verification

Local lifecycle test:

```bash
# 1. Bring up the stack.
docker compose up -d
make migrate-up

# 2. Run the integration test (creates / wipes its own users — safe on dev).
cd services/user
DATABASE_URL=postgresql://nomarkup@localhost:5433/nomarkup?sslmode=disable \
  go test -tags=integration ./internal/repository/... -run TestGDPR
```

Expected output:

```
=== RUN   TestGDPR_FullLifecycle_Integration
--- PASS: TestGDPR_FullLifecycle_Integration
=== RUN   TestGDPR_ListPendingFinalizations_RespectsCutoff
--- PASS: TestGDPR_ListPendingFinalizations_RespectsCutoff
PASS
```

Service-layer unit tests (mocks, no DB):

```bash
go test ./internal/service/ -run TestErasure
```

End-to-end manual (only after the user has explicitly opted in to dev
testing, never on a real user):

```bash
TOKEN=$(curl ... /auth/login | jq -r .access_token)

# Request.
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
     -d '{"reason":"no longer needed","confirmation":"DELETE"}' \
     http://localhost:8080/api/v1/users/me

# Cancel.
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8080/api/v1/users/me/restore

# Force-finalize as admin.
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:8080/api/v1/admin/users/$USER_ID/finalize-deletion
```

## What's NOT in scope of this PR

- **Real email delivery** at request / cancel / finalize time.
  The hooks are in place (logged via slog with `TODO: real email`); the
  notification-service template work is its own ticket.
- **Sentry / Mixpanel / external analytics deletion.** Manual today.
  Add `AnalyticsDeleter` interface alongside `OAuthRevoker` when those
  providers are wired.
- **S3 prefix deletion + OAuth revoke.** Interfaces are in place
  (`ObjectStoreDeleter`, `OAuthRevoker`) but main.go still wires `nil`.
  Stripe deletion (the previous TODO) shipped 2026-04 — see
  "Stripe Deletion Adapter" above.

## Owner

- **Policy owner:** Legal.
- **Implementation owner:** User Service team.
- **Operational runbook:** Trust & Safety oncall — they triage
  `gdpr_deletions_failed_total > 0` alerts.
