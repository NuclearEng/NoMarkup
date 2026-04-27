# Runbook: Provider Payout Failed

> Stripe Connect payout to a provider's bank account failed. The provider sees
> "Payout Failed" in their wallet, contacts support, or churns silently.

## Symptoms

- Stripe Dashboard → Connect → Connected Account → "Payouts failed" indicator.
- Webhook events received: `payout.failed`, `payout.canceled`, `account.updated`
  with `requirements.disabled_reason` populated.
- Provider support ticket: "I completed the job but didn't get paid."
- Logs (payment service):
  ```
  payout.failed received: account=acct_xxx, amount=12345, failure_code=...
  ```

## Diagnosis

1. **Find the failed payout** in Stripe Dashboard:
   - Connect → Connected Accounts → search by Stripe account ID (`acct_xxx`) or platform user ID.
   - Click into the account → Payouts tab → click the failed payout.
   - Note `failure_code` (e.g. `account_closed`, `insufficient_funds`, `bank_ownership_changed`, `debit_not_authorized`, `invalid_account_number`).

2. **Map failure code to root cause:**

   | Failure code               | Root cause                                  | Customer-facing fix          |
   |---------------------------|---------------------------------------------|------------------------------|
   | `account_closed`          | Bank account closed                         | Provider must add new bank   |
   | `account_frozen`          | Bank account frozen by issuing bank         | Provider contacts bank       |
   | `bank_ownership_changed`  | Recipient mismatch (KYC vs account holder)  | Provider re-verifies         |
   | `debit_not_authorized`    | Bank rejected the inbound transfer          | Provider contacts bank       |
   | `insufficient_funds`      | Platform balance too low (rare; ours)       | Top up Stripe balance        |
   | `invalid_account_number`  | Routing/account typo                        | Provider re-enters details   |
   | `no_account`              | Account not found at receiving bank         | Provider re-enters details   |
   | `incorrect_account_holder_name` / `_address` / `_tax_id` | KYC mismatch       | Provider updates Stripe profile |

3. **Confirm KYC / Connect onboarding state:**
   ```bash
   # GET to our gateway, returns the cached account state:
   curl -s -H "Authorization: Bearer <admin-token>" \
     https://nomarkup.com/api/v1/admin/users/<provider_user_id>/stripe
   ```
   Look at `requirements.currently_due` — if non-empty, the provider has unfinished onboarding tasks.

4. **Check escrow state for the related job:**
   ```sql
   SELECT id, status, amount_cents, customer_id, provider_id, updated_at
     FROM payments
    WHERE provider_id = '<uuid>' AND status = 'pending_payout'
    ORDER BY updated_at DESC LIMIT 10;
   ```
   The escrow funds are still held on the platform balance; they are NOT lost. Once the bank issue is fixed, retry will succeed.

## Mitigation

### Path A: Provider data fix needed (most common)

1. In-app notification + email is sent automatically by `payout.failed` webhook handler. Verify it actually fired:
   ```bash
   kubectl logs -n nomarkup deployment/notification --tail=200 | grep -i payout_failed
   ```
2. If missing, manually trigger the email via the admin tool or:
   ```sql
   INSERT INTO notifications (id, user_id, type, payload, created_at)
   VALUES (gen_random_uuid(), '<provider_user_id>', 'payout_failed',
           '{"failure_code":"...","amount_cents":12345}'::jsonb, now());
   ```
3. Educate provider: send link to their **Wallet → Update Bank Details** page. The Stripe Connect onboarding link auto-rotates the failure context.

### Path B: Manual retry after provider has fixed their bank

1. Confirm `requirements.disabled_reason` is now NULL on the Connect account (Stripe Dashboard or API).
2. Trigger a manual payout:
   ```bash
   stripe payouts create \
     --amount=<cents> --currency=usd \
     --destination=<bank_account_id> \
     --stripe-account=acct_xxx \
     --metadata[platform_payment_id]=<our_uuid>
   ```
3. Or via our admin endpoint (preferred — keeps audit trail):
   ```bash
   curl -X POST https://nomarkup.com/api/v1/admin/payments/<id>/retry-payout \
     -H "Authorization: Bearer <admin-token>"
   ```
4. Confirm `payout.paid` webhook arrives (typically 1–2 business days).

### Path C: Platform balance insufficient (rare)

This means we owe more in pending payouts than is in the Stripe Connect platform balance — usually a clearing-time mismatch.

1. Check platform balance:
   ```bash
   stripe balance retrieve
   ```
2. If genuinely low, top up via Stripe Dashboard → Balance → Add funds (ACH from the platform's connected business bank).
3. Stripe will retry the payout automatically once balance is positive.

### Path D: Compliance hold (provider on Stripe / platform restricted list)

1. Check `restricted_reason` in `account.updated` webhook payload.
2. Escalate to Trust & Safety. **Do NOT manually retry** — the provider may be flagged for fraud.
3. Hold the escrow and follow the formal review process documented in
   `docs/runbooks/06-fraud-false-positive.md` (mirror procedure, opposite outcome).

## Resolution

1. `payout.paid` webhook received and processed.
2. `payments.status` row flipped to `paid_out`, `payout_at` populated.
3. Provider's wallet shows the funds disbursed.
4. No outstanding `payouts` rows in `failed` state for this provider.

## Escalation

- 30+ min unresolved + customer waiting → page Trust & Safety on-call.
- Multiple providers failing simultaneously → page Payments engineering lead; check Stripe status.
- Compliance hold suspected → page Legal + Trust & Safety.

## Postmortem Template (only required if customer-impacting > 24h)

```
## Incident: Provider Payout Failure YYYY-MM-DD
- Provider Stripe account: acct_xxx
- Failure code: <code>
- Time-to-resolution: HH:MM
- Funds held: $X (still safe in platform balance)
- Customer impact: provider <name> blocked from withdrawing for HH:MM

### Action items
- [ ] If repeat failure code on this account: flag for KYC re-review
- [ ] If new failure code we haven't seen: add to mapping table above
```
