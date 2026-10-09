# Workflow catalog + request log (determinism)

Every user action is a **workflow step**. UI taps and screen changes are recorded locally; API hops also carry `X-Request-ID` so they join to gateway logs.

**Coverage (this build):** every web page (document click/submit + pathname), every shadcn `Button`, every iOS control activation (`sendAction`) and navigation title (`viewDidAppear`), every HTTP hop on both clients. Typed field values (passwords, PANs) are never stored.

To audit it you need three things that join on one id:

1. **Catalog** — what the step is supposed to do (`docs/workflows/catalog.yaml`).
2. **Client request log** — what this device/browser actually sent (status, duration, `X-Request-ID`).
3. **Gateway slog** — what the server did (`request_id` on every JSON log line).

## YAML is SSOT

`docs/workflows/catalog.yaml` is the source of truth (GET + mutations + admin + money inner). `catalog.json` is **generated** — Playwright, the Chi contract test, and VCR all read JSON.

```bash
# Write catalog.json + pages.json
node docs/workflows/generate-catalog.mjs
# or: make generate-catalog

# Fail if catalog.json drifted from yaml (CI)
node docs/workflows/generate-catalog.mjs --check
# or: make check-catalog
```

Do not edit `catalog.json` by hand. Parser is zero-dependency (this schema only — no js-yaml).

Page inventory (all App Router `page.tsx` files): `docs/workflows/pages.json` (same generate command).

## VCR (frozen HTTP fixtures)

`web/tests/e2e/catalog/fixtures/*.json` — one file per catalog hop (`method`, `path`, `status`, `contentType`, `body`). No secrets, no PANs. `{id}` path params are wildcards.

- **CI / no gateway** (`SEED_PASSWORD` unset): Playwright installs `page.route` and fulfills catalog API hops from fixtures. Completeness test requires a fixture for every workflow with method+path.
- **Live stack**: catalog spec hits the real API (`expectHttpHop`). Money fixtures return 4xx — they must not charge.

```bash
# Backendless (what CI runs)
make e2e-catalog
# or: cd web && npm run test:e2e:catalog

# Live hops + SCREEN walk
SEED_PASSWORD=Password123! make e2e-catalog
```

Chi contract: `cd gateway && go test ./internal/router/ -count=1 -run Catalog` — every catalog path+method must appear as a Chi registration in `router.go` (rename cannot stay green).

## Where to look after you tap something

| Surface | Path |
|---------|------|
| iOS | Account → **Request log** (`account.row.requestLog`) |
| Web | Settings → **Request log** (`/settings/request-log`) |
| Gateway | JSON logs field `request_id` (honours client `X-Request-ID`, echoes it on the response) |

The log never stores bodies, Authorization, or query strings. The web page also fetches `GET /api/v1/me/activity` when signed in and merges by `request_id` (401/404 → local hops only).

## Automate (full E2E)

Requires the local stack (`bin/dev up`) and `SEED_PASSWORD` (seed default `Password123!`).

```bash
# Web — catalog HTTP hops + every static page SCREEN hop (Chromium)
SEED_PASSWORD=Password123! make e2e-catalog
# or: cd web && SEED_PASSWORD=Password123! npm run test:e2e:catalog

# iOS Simulator — login/hub hops in Account → Request log
make e2e-ios-catalog
```

PASS rule in CI: **VCR catalog is a required check** (`e2e-test` → Catalog VCR step, in `build.needs`). Live seed-persona login is optional here. With a stack: every seed persona logs in, every catalog GET/mutation appears in `__NOMARKUP_ACTION_LOG__` with the expected status (admin APIs 403 for non-admin).

## How to validate one action

1. Open Request log (or keep it in a split window on web).
2. Perform the catalog step (button, text field, submit).
3. Newest rows: a `ui`/`TAP` (or `SUBMIT`) then an `http` hop with status, duration, request id.
4. Search gateway logs for that `request_id`. Same hop.

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
- **Frozen HTTP fixtures / VCR** per workflow (`web/tests/e2e/catalog/fixtures/`).
- **Contract tests:** catalog.json path ↔ gateway Chi route (`gateway/internal/router/catalog_contract_test.go`).
- **Server activity:** `user_request_activity` + `GET /api/v1/me/activity` (owner-only). Web request log merges local hops by `request_id`.
- **XCResult:** every ScreenshotWalk `snap` attaches `{name}-request-ids` from `debug.requestLog.latest`.
- **Device-only:** `DeviceCapabilityUITests` XCTSkip on Simulator (Apple Pay / APNs / Face ID). Never PASS on sim.

Still required (not claimed done):

| Gap | Why it matters |
|-----|----------------|
| Live `SEED_PASSWORD` catalog personas | VCR is the CI gate; live mutations need `bin/dev` + seed |
| Physical-device run of Apple Pay sheet / real APNs token / Face ID enroll | Simulator XCTSkip is the honest residual; device tests assert wiring only |
| Full Account XCUITest sweep after harness fixes | Admin sheet + tab-bar clearance + expected-hidden are in code; 45-min walk not re-run this change |

Do not mark a workflow PASS from a screenshot alone. PASS = catalog step + request-log row + expected HTTP status.
