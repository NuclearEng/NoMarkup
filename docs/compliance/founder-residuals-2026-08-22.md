# Founder residuals inventory — 2026-08-22

**Status:** Open. **Engineering cannot close these without Founder.** This file is
an inventory of live evidence from this session, not a claim that production is
live.

**Honesty rule:** Do **not** set `DEPLOY_PROVISIONED=true`. Do **not** commit
secrets. Do **not** invent AWS account IDs, Cloudflare Zone/Account IDs, or ASC
credentials. Stripe Dashboard APIs were **not** called with live keys. App Store
Connect was **not** uploaded to.

**Capital-light path (day-one):** Cloudflare Free + AWS Lightsail + Compose +
Caddy — [`docs/operations/prod-launch-todo.md`](../operations/prod-launch-todo.md).
The K8s `deploy.yml` gate is a **later** graduation path, still fail-closed.

**Machine-check:** `make founder-secrets-check` (advisory) and
`./scripts/founder-secrets-check.sh --strict`. Reports present / missing /
placeholder / not-armed only — **never prints values**. A green row is local
visibility, not a provisioned production.

---

## Snapshot table

| ID | Item | Evidence command | Result | Owner | Unblocks |
|----|------|------------------|--------|-------|----------|
| DEPLOY | `DEPLOY_PROVISIONED` | `founder-secrets-check`; GitHub Actions variables | **missing / not-armed** (local, process env, repo vars). `deploy.yml` fail-closed until `true`. | Founder | tag deploy (K8s path only — **do not flip**) |
| STRIPE | live keys + webhook `https://api.no-markup.com/api/v1/webhooks/stripe` | prefix-only local classify; `git grep` (redacted); curl health | Local keys are **test** (`sk_test` / `pk_test`). `STRIPE_WEBHOOK_SECRET` **present locally** (`whsec_`). **No** `sk_live` / real `whsec_` committed. Origin **does not resolve** — webhook URL cannot receive events. | Founder | money in prod |
| DNS | `no-markup.com` A/proxied | `dig +short`; curl HTTPS | **NS live at Cloudflare**; **zero A/AAAA** for `@` / `www` / `api`. curl **000** (`Could not resolve host`). No anycast IPs to record. | Founder | public site |
| ASC | App Store Connect / IAP / Apple Pay merchant | cannot automate without Apple ID | **Portal-only.** Eng packaging + free-tier IAP lock in-repo. Domain association file is **PLACEHOLDER**. Merchant ID string in binary is not a registered merchant. | Founder | TestFlight / IAP (IAP deferred for v1) |

**Production is not live.** DNS that only has nameservers is not an origin.

---

## Commands run this session

### founder-secrets-check

| Invocation | Mode | Exit | Summary |
|------------|------|------|---------|
| `make founder-secrets-check` | advisory (`ENVIRONMENT=development`) | **0** | 10 / 13 rows not present; ADVISORY |
| `./scripts/founder-secrets-check.sh --strict` | strict | **1** | same table; `FAIL: fail-closed` |

Sources: `.env.local` **found** (gitignored); `deploy/prod/.env` **absent**.

Table (values never printed):

| KEY | STATUS |
|-----|--------|
| `GOOGLE_CLIENT_ID` | missing |
| `GOOGLE_CLIENT_SECRET` | missing |
| `FACEBOOK_CLIENT_ID` | missing |
| `APPLE_CLIENT_ID` | missing |
| `SENDGRID_API_KEY` | missing |
| `SENTRY_DSN` | missing |
| `NEXT_PUBLIC_SENTRY_DSN` | missing |
| `DEPLOY_PROVISIONED` | **missing** (present only when `true`) |
| `STRIPE_WEBHOOK_SECRET` | **present** (local) |
| `ENCRYPTION_KEY` | **present** (local) |
| `CHECKR_API_KEY` | missing |
| `NOMARKUP_STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **present** (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) |
| `APPLE_PAY_DOMAIN_ASSOCIATION` | **placeholder** (`web/public/.well-known/apple-developer-merchantid-domain-association`) |

### Unexpected PRESENT?

**None of the four Founder residuals is unexpectedly PRESENT as production.**

| Row | Present? | Interpretation |
|-----|----------|----------------|
| `DEPLOY_PROVISIONED` | **No** (missing locally; **not** in GitHub repo Actions variables; no `production` environment vars; process env unset) | **Correct.** Must stay unset/false until a real cluster + secrets exist. |
| Stripe live `sk_live` | **No** | Local secret is `sk_test`. Git has placeholders / test fakes only. |
| Stripe publishable | Local **`pk_test` only** | Expected for `bin/dev`. Not live. `NOMARKUP_STRIPE_PUBLISHABLE_KEY` empty. |
| `STRIPE_WEBHOOK_SECRET` | **Yes, local** | Expected for Stripe **test** dogfood. Prefix `whsec_` does not encode test vs live. Origin is down, so this is not a live endpoint secret. |
| `ENCRYPTION_KEY` | **Yes, local** | Expected for local PII cipher. Not a production Vault entry. |
| Apple Pay association | **placeholder** | Expected. Do not invent bytes. |

### DNS (`dig`)

Ran `dig +short` and `dig @1.1.1.1` / `@8.8.8.8` for `no-markup.com`,
`www.no-markup.com`, `api.no-markup.com`.

| Query | Result |
|-------|--------|
| `A` `@` / `www` / `api` | **empty** (all resolvers) |
| `AAAA` `@` | **empty** |
| `CNAME` `www` / `api` | **empty** |
| `TXT` / `MX` | **empty** |
| `NS no-markup.com` | `coen.ns.cloudflare.com.` / `desiree.ns.cloudflare.com.` |
| `SOA` | `coen.ns.cloudflare.com. dns.cloudflare.com.` serial `2411477240` |
| whois registrar | **Cloudflare, Inc.**; status `clientTransferProhibited`; expiry **2027-06-08** |
| `nomarkup.com` A/NS | **empty** (zone **not owned** — hyphenated `no-markup.com` is the product zone) |

**No IPs to record.** Anycast vs raw does not apply until A records exist and
orange-cloud proxy is on. Zone exists; **public site does not.**

### HTTPS probes

```
curl -sS -m 10 -o /dev/null -w '%{http_code}' https://no-markup.com
curl -sS -m 10 -o /dev/null -w '%{http_code}' https://api.no-markup.com/healthz
```

| URL | HTTP | Notes |
|-----|------|-------|
| `https://no-markup.com` | **000** | `curl: (6) Could not resolve host: no-markup.com` |
| `https://www.no-markup.com` | **000** | same |
| `https://api.no-markup.com/healthz` | **000** | `Could not resolve host: api.no-markup.com` |

Failure **is** evidence: no origin, no TLS, no `healthz` 200. Do **not** claim
production.

### Git live-key scan (must NOT be committed)

Tracked matches for `sk_live_` / `pk_live_` / `whsec_` are **placeholders,
docs, or test fakes** (e.g. `sk_live_CHANGE_ME`, `sk_live_…`,
`sk_live_*_must_not_fake` in handler tests). **No committed live secret values.**

`.env.local` and `deploy/prod/.env` are **gitignored**. Security: **PASS** for
the git tree. (Local files still must never be force-added.)

---

## DEPLOY — `DEPLOY_PROVISIONED`

**Must stay unset/false until a real cluster + secrets exist.** This session
did **not** set it.

| Surface | Evidence |
|---------|----------|
| `.env.local` | missing |
| `deploy/prod/.env` | file absent |
| process env | unset |
| GitHub repo Actions variables | `DEPLOY_PROVISIONED` **not listed** |
| GitHub `production` environment | **404** (only `github-pages` exists) |
| [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) | First step exits 1 when `vars.DEPLOY_PROVISIONED != 'true'` |

Day-one production is **Lightsail Compose**, not this K8s workflow
([`prod-launch-todo.md`](../operations/prod-launch-todo.md) Phase 7: do **not**
set the flag until/unless moving to the K8s path).

### What a human does next (1–3)

1. **Do nothing to this flag.** Leave GitHub Variables empty. A `v*` tag must
   keep failing closed.
2. For a public origin, execute **Phase 1 Lightsail** (create `nomarkup-prod`,
   static IP, TCP 22/80/443) — not EKS. Paste `Lightsail IP: x.x.x.x` to eng
   after SSH works.
3. Only if graduating to K8s later: finish
   [`provisioning-checklist.md`](../operations/provisioning-checklist.md)
   (Vault/ESO secrets, `KUBE_CONFIG`, `REGISTRY_PASSWORD`, migrate-on-deploy),
   **then** set the repo/environment variable. Missing credentials after a flag
   flip still fails — that is intentional.

---

## STRIPE — live keys + webhook

Canonical webhook URL (do not use apex for production):

**`https://api.no-markup.com/api/v1/webhooks/stripe`**

| Fact | Evidence |
|------|----------|
| Local secret | `sk_test` (TEST) |
| Local publishable | `pk_test` (TEST); iOS `NOMARKUP_STRIPE_PUBLISHABLE_KEY` empty |
| Local webhook secret | present (`whsec_`) — **test dogfood**, not proof of Live |
| Live keys in git | **none** (PASS) |
| Public origin to receive webhooks | **does not resolve** |
| Session note 2026-08-05 | Test webhook was created on **apex** `https://no-markup.com/api/v1/webhooks/stripe` — must **move to `api` host** after DNS ([`stripe-cloudflare-live-setup-2026-08-05.md`](../operations/stripe-cloudflare-live-setup-2026-08-05.md)) |

This inventory did **not** call Stripe Dashboard APIs with live keys.

### What a human does next (1–3)

From [`prod-launch-todo.md`](../operations/prod-launch-todo.md) **Phase 5**:

1. After `api.no-markup.com` answers: Dashboard → **test** webhook endpoint at
   `https://api.no-markup.com/api/v1/webhooks/stripe` (events: `payment_intent.*`,
   `charge.dispute.*`, `transfer.created`, `charge.refunded`, `account.updated`,
   `setup_intent.*`, `payment_method.detached`, plus subscription/invoice as
   needed). Put the new `whsec_` on the **server** `.env` (never git). Disable
   the obsolete apex URL unless the web proxy deliberately forwards `/api/*`.
2. Keep **test** keys on the box until smoke (`healthz` 200 + one signed event
   accepted). Trigger a test event; confirm the payment service accepts the
   signature.
3. **Live mode only after** smoke + product freeze: activate Stripe payments,
   switch to Live keys on the server, create a **new Live** webhook on the same
   `api` path, small real-money smoke. Never commit `sk_live` / Live `whsec_`.

---

## DNS — zone `no-markup.com`

Hyphenated zone is the product. **`nomarkup.com` is not owned.**

Cloudflare **is** the registrar and nameserver (NS + SOA above). That is **not**
the same as orange-cloud A records or a public site.

[`cloudflare-edge.md`](../operations/cloudflare-edge.md): in-repo inventory is
origin cache headers + auth-bypass **recipe**. Live CF rules / Zone ID / Account
ID stay in Founder Vault — **not** committed; this session did not invent them.

### What a human does next (1–3)

From [`prod-launch-todo.md`](../operations/prod-launch-todo.md) **Phase 1 then 3**
(A records need a Lightsail static IP first):

1. Create Lightsail Ubuntu 24.04 in us-west-2/us-west-1, attach **static IPv4**,
   firewall TCP 22/80/443. Confirm `ssh ubuntu@STATIC_IP`.
2. Cloudflare zone `no-markup.com` → proxied (orange) **A** records:
   `@`, `www`, `api` → that static IP. SSL/TLS **Full**, then **Full (strict)**
   once the origin cert is valid. Confirm `dig +short api.no-markup.com` returns
   **CF anycast**, not the raw Lightsail IP.
3. Apply the API **auth cache-bypass** expression
   ([`cdn-cache-auth-bypass.md`](../operations/cdn-cache-auth-bypass.md)). Then
   `https://api.no-markup.com/healthz` must be **200** before claiming the site
   is up.

---

## ASC — App Store Connect / IAP / Apple Pay

**Cannot automate without an Apple ID.** Eng cannot create the ASC app record,
register the merchant, or upload a build.

| Surface | In-repo reality | Founder still owns |
|---------|-----------------|--------------------|
| Bundle ID | `com.nomarkup.app` | App ID + SIWA + Push on the Developer portal |
| Binary / packaging | Eng docs + free-tier lock ([`asc-packaging-checklist.md`](./asc-packaging-checklist.md), [`testflight-process.md`](./testflight-process.md)) | Team signing, Xcode 26+ archive, TestFlight group |
| StoreKit IAP (Rail B) | **Off** — `StoreKitEnabled=false`; v1 is free-tier. Do **not** create IAP products for v1 ([`launch-board.md`](./launch-board.md) B2) | Later: ASC subscription products + flip flags |
| Apple Pay (Rail A wallet) | Entitlement string `merchant.com.nomarkup.app`; association file is **PLACEHOLDER** | Register merchant ID; Stripe/Apple domain verify **after** DNS; replace placeholder — **do not invent bytes** |
| Release API host | Empty `APIBaseURL` → `https://api.no-markup.com` | Host must exist (DNS + origin) or TestFlight Release cannot dogfood |

### What a human does next (1–3)

From [`prod-launch-todo.md`](../operations/prod-launch-todo.md) **Phase 6** and
launch-board founder columns:

1. Apple Developer: App ID `com.nomarkup.app` with Sign in with Apple + Push;
   register Apple Pay merchant `merchant.com.nomarkup.app`. Create the **ASC app
   record** (SKU, Shopping / Lifestyle, support/privacy URLs on `no-markup.com`
   — those URLs also need DNS).
2. After `api.no-markup.com` is up: Archive with **Xcode 26+**, upload TestFlight,
   Internal group, device smoke against **prod API** (Release has no LAN
   cleartext). Paste Review Notes; seed password only in the ASC secure field.
3. Apple Pay domain: Stripe Dashboard → add `no-markup.com` → download the
   association file → **replace**
   `web/public/.well-known/apple-developer-merchantid-domain-association` →
   deploy → verify. **Do not invent the file.** IAP products stay **deferred**
   for the free-tier binary.

---

## Eng vs Founder

**Eng cannot close these without Founder.** Code, Compose, fail-closed deploy,
and the secrets-check inventory are as far as the repo can go. Remaining work
is consoles, a VPS IP, DNS clicks, Stripe Dashboard, and Apple ID.

Related boards (not done-claims):

- [`founder-action-board.md`](./founder-action-board.md)
- [`docs/operations/prod-launch-todo.md`](../operations/prod-launch-todo.md)
- [`docs/operations/provisioning-checklist.md`](../operations/provisioning-checklist.md)
- [`docs/operations/capital-light-production.md`](../operations/capital-light-production.md)

**Resume phrases:** `resume production deploy` or `Lightsail IP: x.x.x.x`.
Until then: local `bin/dev` + Stripe **test** only.
