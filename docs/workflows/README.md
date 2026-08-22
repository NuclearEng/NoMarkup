# Workflow catalog + request log (determinism)

Every user action is a **workflow step**. UI taps and screen changes are recorded locally; API hops also carry `X-Request-ID` so they join to gateway logs.

**Coverage (this build):** every web page (document click/submit + pathname), every shadcn `Button`, every iOS control activation (`sendAction`) and navigation title (`viewDidAppear`), every HTTP hop on both clients. Typed field values (passwords, PANs) are never stored.

To audit it you need three things that join on one id:

1. **Catalog** — what the step is supposed to do (`docs/workflows/catalog.yaml`).
2. **Client request log** — what this device/browser actually sent (status, duration, `X-Request-ID`).
3. **Gateway slog** — what the server did (`request_id` on every JSON log line).

## Where to look after you tap something

| Surface | Path |
|---------|------|
| iOS | Account → **Request log** (`account.row.requestLog`) |
| Web | Settings → **Request log** (`/settings/request-log`) |
| Gateway | JSON logs field `request_id` (honours client `X-Request-ID`, echoes it on the response) |

The log never stores bodies, Authorization, or query strings.

## Automate (full E2E)

Requires the local stack (`bin/dev up`) and `SEED_PASSWORD` (seed default `Password123!`).

```bash
# Web — catalog HTTP hops + every static page SCREEN hop (Chromium)
SEED_PASSWORD=Password123! make e2e-catalog
# or: cd web && SEED_PASSWORD=Password123! npm run test:e2e:catalog

# iOS Simulator — login/hub hops in Account → Request log
make e2e-ios-catalog
```

PASS rule in CI: **every seed persona** (customer, provider, provider2, admin) logs in, every catalog GET appears in `__NOMARKUP_ACTION_LOG__` / `requestLog.httpCount` with the expected status (admin flags 403 for non-admin).

## How to validate one action

1. Open Request log (or keep it in a split window on web).
2. Perform the catalog step (button, text field, submit).
3. Newest rows: a `ui`/`TAP` (or `SUBMIT`) then an `http` hop with status, duration, request id.
4. Search gateway logs for that `request_id`. Same hop.

Page inventory (all App Router `page.tsx` files): `docs/workflows/pages.json` (regenerate with `node docs/workflows/generate-catalog.mjs`). Named API workflows: `docs/workflows/catalog.yaml`.

## Personas

Seed: `customer@nomarkup.com`, `provider@nomarkup.com`, `admin@nomarkup.com` / `Password123!`.

`customer@` is dual-role (`customer` + `provider`) in this seed — provider GETs succeed. Admin APIs stay 403 without `admin`.

## What else makes this deterministic

Already in the tree:

- Client-minted **`X-Request-ID`** (web was already on this path; iOS now stamps the same header).
- **Idempotency-Key** on money POSTs.
- **Seed fixtures** + golang-migrate (never edit a shipped migration).
- XCUITest a11y ids (`account.row.*`) and Playwright `data`/role selectors.
- Feature flags fail-closed in production; iOS `iOSHardOffKeys` for regulated rails.

Still required for a 100% audit bar (not claimed done):

| Gap | Why it matters |
|-----|----------------|
| Frozen HTTP fixtures / VCR per workflow | Replay without a live gateway; prove status + JSON shape |
| Contract tests: catalog.yaml path ↔ gateway Chi route | Drift detector so a renamed API cannot stay green |
| Screenshot + request-id in the same XCResult | Visual + wire in one artifact |
| Server-side user activity table | Device log is lost on reinstall; GDPR-scoped server copy is the durable audit |
| Plan-limit **enforcement** on bid/category/portfolio paths | Catalog numbers are display + `GetUsage` today; placing a 4th bid is not rejected |
| Physical-device Apple Pay / APNs / Face ID | Simulator cannot PASS those |

Do not mark a workflow PASS from a screenshot alone. PASS = catalog step + request-log row + expected HTTP status.
