# In-scope close — Checkr, off-session, StoreKit, public origin, field RUM

**Date:** 2026-08-12  
These five were parked as founder/legal. They are now **in scope**. Honest rule: we ship complete *product paths* that go live when keys/flags are set. We do **not** invent API keys, Apple Pay association bytes, or flip `DEPLOY_PROVISIONED`.

## F4 — Checkr live path

**Shall:** When `background_checks` is enabled **and** `CHECKR_API_KEY` + `CHECKR_PACKAGE` are set, a provider can start a real Checkr invitation. Webhook updates status after HMAC verify. When the flag is on, **PlaceBid / listing bid** for a provider is 403 unless latest check status is `clear` or `consider` (never invent `clear`). Missing key → start stays 503; bid gate uses DB status only (cannot bid if no row).

**Not:** creating a Checkr account.

### API / UI
- POST/GET `/providers/me/background-check` already exist. Return `invitation_url` when Checkr returns one.
- Web: provider verification page — start + status + open invitation.
- iOS VerificationCenter already has request; show `invitation_url` if present.
- Gateway PlaceBid + listing PlaceBid: if `IsFeatureDisabled(..., "background_checks")` is false (flag ON), require status.

## F5 — Goods off-session charge

**Shall:** Bid-authorization language exists in shipped Terms (`id: payments`, version `tos-2026-08-12-bid-auth`). Operator may set `MARKETPLACE_OFFSESSION_TOS_VERSION=tos-2026-08-12-bid-auth` and `MARKETPLACE_OFFSESSION_CHARGE=true`. Charge path already exists (`ChargeListingWinner` + default PM). Listing bid / BIN UI discloses the authorization. **Defaults stay off** until those two env vars are set (production still fatal if charge=true without TOS version).

**Not:** silently charging in production without the env pair.

## F6 — StoreKit verify (crypto)

**Shall:** `POST /api/v1/iap/app-store/verify` walks JWS `x5c` against **embedded Apple Root CA - G3** (public Apple cert, not a secret). When `APP_STORE_IAP_VERIFY=true` and chain+signature verify, return `{valid:true, product_id, transaction_id}`. Persist entitlement (`126_iap_entitlements`). `StoreKitEnabled` stays **false** in Info.plist (free-tier binary). Flipping the client flag + env is enough to go live after ASC products exist.

**Not:** flipping StoreKitEnabled in the committed binary.

## F7 — Public origin

**Shall:** Canonical production hosts are `https://no-markup.com` and `https://api.no-markup.com`. `scripts/origin-check.sh` probes `/api/v1/health` (or gateway health), `/pricing`, and the Apple Pay association URL. `.env.example` + `deploy/prod` document `PUBLIC_API_URL` / `NEXT_PUBLIC_API_URL` / `FRONTEND_URL`. iOS Release already uses `api.no-markup.com`.

**Not:** provisioning Lightsail or setting `DEPLOY_PROVISIONED=true`.

## F8 — Field RUM

**Shall:** Browser reports LCP, INP, CLS, TTFB, FCP to `POST /api/v1/rum` (public, rate-limited, no cookies/PII). Gateway stores samples (Redis or `125_rum_samples`). `GET /api/v1/admin/rum` returns p75 by metric + route. `WebVitalsReporter` posts in production (dev stays console). Never `console.log` in prod.

## Migrations
- `125_rum_samples`
- `126_iap_entitlements`

## Tests
- Checkr bid 403 without clear/consider when flag on; 503 start without key.
- Off-session: terms contain bid-authorization string; legal gate still refuses charge=true without TOS version.
- IAP: garbage JWS 400; alg=none 400; valid-looking but untrusted cert 400; with test key+leaf signed under a test root injected in tests, valid:true.
- RUM: POST accepted; admin GET p75; no PII fields stored.

---

## Re-audit 2026-08-12

| Feature | Shall | Status | Honest residual |
|---------|-------|--------|-----------------|
| **F4 Checkr** | Live path + bid gate | **PASS (path)** | Needs `CHECKR_API_KEY` + `CHECKR_PACKAGE` + flag ON to call vendor. Bid 403 without clear/consider when flag on. Never invents PASS. |
| **F5 Off-session** | ToS + armable charge | **PASS (armable)** | Terms ship `tos-2026-08-12-bid-auth`. Charge still **off** until operator sets both env vars. |
| **F6 StoreKit** | x5c verify | **PASS (crypto)** | `valid:true` only after chain+ES256. `StoreKitEnabled` still false in Info.plist. Needs ASC products + `APP_STORE_IAP_VERIFY=true`. |
| **F7 Origin** | Canonical hosts + probe | **PASS (wiring)** | `make origin-check` allow-down: 0/3 (no public DNS). Not `DEPLOY_PROVISIONED`. |
| **F8 RUM** | Field beacon + p75 | **PASS (ingest)** | POST `/api/v1/rum` + admin p75. Apply migration 125. |

**Still human:** Checkr vendor account, env pair for off-session, ASC products + client flag, Lightsail/DNS/`DEPLOY_PROVISIONED`, apply migrations 125–126.
