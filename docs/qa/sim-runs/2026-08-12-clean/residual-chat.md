# Residual — Messages empty after clean seed

**Date:** 2026-08-12  
**No commit.** Seed + iOS copy only.

Walk leftover: customer/provider had **0 chat channels** after wipe + `make seed`. Provider placed a bid and already had 2 contracts; inbox stayed empty. Empty copy said threads open *when you bid*.

## Closed

| Item | Status | Where |
|------|--------|--------|
| Seed thread customer@ ↔ provider@ | **FIXED** | [`database/cmd/seed/main.go`](../../../../database/cmd/seed/main.go) §7a — `chat_channels` `…0350` on awarded job `…0101` (Kitchen Sink Leaking / contract `NM-2026-00001`), `channel_type=contract`, 3 text messages `…0351`–`…0353`. Idempotent on `(job_id, customer_id, provider_id)`. |
| Empty-state overclaim | **FIXED** | [`ios/NoMarkup/Features/MessagesView.swift:175`](../../../../ios/NoMarkup/Features/MessagesView.swift) — no longer says bidding (or winning a listing) opens a thread. |

## Seed fixture

- **Channel** `00000000-0000-0000-0000-000000000350`
  - job `00000000-0000-0000-0000-000000000101` (Kitchen Sink Leaking)
  - customer `…0002` / provider `…0003`
  - `channel_type=contract`, `status=active`, `message_count=3`
- **Messages** (customer, provider, customer) — diagnose / Thursday 9am / confirm
- Admin is not a party (`chat_channels` is customer+provider only)

`make seed` twice → still **1** channel, **3** messages.

## API evidence (live `http://127.0.0.1:8081`, local DB)

`POST /api/v1/auth/login` customer@ + `Password123!` → 200.

`GET /api/v1/channels` **customer@**:

- HTTP 200
- `pagination.totalCount` **1**
- `channels[0].id` = `00000000-0000-0000-0000-000000000350`
- last message: “Thursday at 9 is perfect. I'll leave the cabinet doors open.”

Same list as **provider@** (`totalCount` 1, same id).

`GET /api/v1/channels/…0350/messages` customer@ → 3 messages, both parties.

## Copy

**Before:** “Your threads open when you bid, award a job, or win a local listing…”

**After:** “A conversation starts when a job is awarded, a contract is accepted, or someone messages you. Bidding or winning a listing does not open a thread on its own — pull to refresh anytime.”

Web `ChannelList` already said “when you start messaging” — left alone.

## Not claimed

- Product still does **not** auto-open a channel on bid or contract accept (FR-8.1 is explicit). Seed is a fixture, not that behavior.
- iOS Messages UI not recaptured this pass (no sim rebuild). Inbox will show the kitchen-sink thread after the next install + `make seed`.
- Admin Messages stays empty (admin is not on the channel).
