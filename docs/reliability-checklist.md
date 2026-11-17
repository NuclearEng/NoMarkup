# Reliability checklist (diff-triggered)

Every item here is a failure that already happened in this repo. Each one has a **trigger you can read
from a diff**, the **check** that would have caught it, and the **source** incident. Nobody reads the
whole list: `scripts/reliability-check.mjs` prints only the items the current diff triggers (usually 3
to 10) and runs the automatable ones.

```bash
node scripts/reliability-check.mjs                 # list items matching the diff vs origin/main
node scripts/reliability-check.mjs --run --record  # also run the automated checks, record the result
node scripts/reliability-check.mjs --all           # list every item
```

CI (`Reliability Checklist` job, pull requests only) runs the **base branch's** copy of this file and
of the scripts against the PR's diff, so a change cannot loosen the check that judges it. It fails only
when an automated `Run:` check fails; the other matched items are listed in the job summary for the
author and reviewer.

## Item format

The script parses this file. Keep each item in this shape:

- `### RC-NN · Title` starts an item.
- **Paths:** repo-relative globs in backticks (`**` any depth, `*` one segment, `{a,b}`, leading `!`
  excludes). Optional; no paths means every file.
- **Added:** / **Removed:** JavaScript regular expressions in backticks, tested against each added /
  removed line of the files the paths select. Optional; without them a path match alone triggers.
- **Status:** `added`, `modified`, `deleted` or `renamed` — only files with that change status count.
- **Check:** what to verify by hand (or what the automated check enforces).
- **Run:** a shell command, run from the repo root, that exits non-zero on failure. Only cheap commands
  that need no `npm ci`, toolchain or service. `$RC_TOOLS` is the directory holding `checks.mjs`.
- **Source:** the commit(s) or PR that fixed the incident.

An item needs at least one of Paths / Added / Removed. Add an item when a fix lands for a failure a
reviewer could have spotted in the diff; prune items whose trigger never fires or whose check is now
enforced elsewhere (say where in the commit that removes it).

---

## Deploy, images and CI

### RC-01 · PgBouncer rejects session parameters sent in the startup packet
- **Paths:** `gateway/internal/observability/**` `services/*/internal/observability/**` `database/cmd/**` `docker-compose.yml` `deploy/**` `.env.example`
- **Added:** `RuntimeParams|IGNORE_STARTUP_PARAMETERS|statement_timeout|lock_timeout|idle_in_transaction|pool_mode|DB_TIMEOUTS_IN_STARTUP_PACKET`
- **Check:** request-path pools send no GUCs in the startup packet; session timeouts are role defaults
  (migration 137). A new GUC or pooler setting is proven against PgBouncer in transaction mode with the
  verification command in `docs/operations/pgbouncer.md` — not only against a direct Postgres.
- **Source:** e8d6c997, 5e2f517f (four services exited behind the compose pooler: `unsupported startup parameter: lock_timeout`).

### RC-02 · Image build misses a local module or workspace member
- **Paths:** `**/go.mod` `engines/Cargo.toml` `engines/*/Cargo.toml` `deploy/docker/*.Dockerfile`
- **Check:** every `replace … => ../…` target of the Go module an image builds, and every Cargo workspace
  member, is `COPY`'d before the first `go` / `cargo` command of that stage.
- **Run:** `node "$RC_TOOLS/checks.mjs" docker-context`
- **Source:** 5a13b94e (`open /app/pkg/grpmtls/go.mod: no such file or directory`), 0b024405 (`failed to load manifest for workspace member /app/engines/telemetry`).

### RC-03 · Go toolchain pins drift apart
- **Paths:** `**/go.mod` `.github/workflows/*.yml` `deploy/docker/*.Dockerfile`
- **Added:** `^toolchain|GO_VERSION|golang:|go-version`
- **Check:** every `toolchain goX` in go.mod, `GO_VERSION` in the workflows and `FROM golang:X` agree.
- **Run:** `node "$RC_TOOLS/checks.mjs" go-toolchain`
- **Source:** a842cd1b, b5f09c67.

### RC-04 · Registry image name built from a mixed-case owner
- **Paths:** `.github/workflows/*.yml`
- **Added:** `IMAGE_PREFIX|docker push|docker build|kustomize edit set image`
- **Check:** a job that tags images from `IMAGE_PREFIX` lowercases it first (the owner login is `NuclearEng`).
- **Run:** `node "$RC_TOOLS/checks.mjs" image-prefix-lowercase`
- **Source:** #46 / c114b402 (`repository name must be lowercase` on the first push to main after #36).

### RC-05 · Playwright job floats on `ubuntu-latest`
- **Paths:** `.github/workflows/*.yml` `web/package.json` `web/package-lock.json`
- **Added:** `runs-on|playwright`
- **Check:** jobs that run `playwright install` pin the newest Ubuntu image the locked Playwright supports; move back to latest only together with a Playwright upgrade.
- **Run:** `node "$RC_TOOLS/checks.mjs" playwright-runners`
- **Source:** 42152da6 (`Playwright does not support chromium on ubuntu26.04-x64`).

### RC-06 · Hosted Xcode without a simulator runtime
- **Paths:** `.github/workflows/ios-ci.yml`
- **Added:** `[Xx]code|simctl|-destination|DEVELOPER_DIR|runs-on`
- **Check:** pick the highest Xcode that lists an available iPhone simulator; address the simulator by id, not by name.
- **Source:** 27505a8b (`Unable to find a device matching … name:iPhone 16`, 2 of 4 runs with no iOS change).

### RC-07 · New startup-fatal environment variable
- **Paths:** `gateway/cmd/**` `services/*/cmd/**` `engines/*/src/main.rs` `engines/*/src/config.rs` `web/src/lib/server/env.ts`
- **Added:** `Getenv\(|LookupEnv\(|env::var\(|mustEnv|requireEnv|z\.(url|string)\(`
- **Check:** a variable the process refuses to start without is in `.env.example`, `docker-compose.yml`
  (a `${VAR:-}` default is an empty string, which is still fatal), the `fullstack-security-test`
  secrets step in `ci.yml`, `bin/dev`, and the k8s manifests.
- **Source:** 58d12506; ci.yml `Generate throwaway stack secrets` (SESSION_SECRET, STRIPE_WEBHOOK_SECRET).

### RC-08 · Go module whose tests run nowhere
- **Paths:** `**/go.mod` `.github/workflows/ci.yml`
- **Check:** every Go module except `proto/gen/go` has a CI step that runs its `go test` — a guard that does not run is decoration.
- **Run:** `node "$RC_TOOLS/checks.mjs" go-modules-in-ci`
- **Source:** ci.yml notes on `pkg/appleauth` and the database module's golden vectors; `pkg/grpmtls` was untested until this checklist (chore/verification-practices).

## Database and migrations

### RC-09 · Duplicate or gapped migration number
- **Paths:** `database/migrations/**`
- **Check:** numbering is contiguous with no duplicates (two branches inventing the same next number).
- **Run:** `bash scripts/check-migration-sequence.sh`
- **Source:** 1f8767ea, 19562f3d (migration chain did not bootstrap on a fresh database).

### RC-10 · Migration without its down
- **Paths:** `database/migrations/**`
- **Check:** every `NNN_x.up.sql` has `NNN_x.down.sql` and the down actually reverses the up (apply up, down 1, up against a scratch DB).
- **Run:** `node "$RC_TOOLS/checks.mjs" migration-pairs`
- **Source:** CLAUDE.md §5; 19562f3d.

### RC-11 · Editing a migration that already merged
- **Paths:** `database/migrations/*.sql`
- **Status:** `modified` `deleted` `renamed`
- **Check:** a migration on main is never edited; write a new one. The only exception is a change that cannot alter the schema (a comment), stated in the commit.
- **Source:** CLAUDE.md §5 / §15 ("never edit a shipped migration"); 1f8767ea.

### RC-12 · Seeder writes ids a sequence will mint again
- **Paths:** `database/cmd/seed/**`
- **Added:** `INSERT INTO|NM-[0-9]{4}|_seq|nextval|setval`
- **Check:** after inserting explicit numbers into a sequence-backed column, `setval()` the sequence past the highest seeded value (never backwards).
- **Source:** 7ef664b6 (first two `CreateContract` calls after a seed failed with 23505 on `contracts_contract_number_key`).

### RC-13 · Money stored as anything but integer cents
- **Paths:** `database/migrations/*.up.sql` `services/**/*.go` `gateway/**/*.go` `engines/**/*.rs` `web/src/**`
- **Added:** `(amount|price|fee|total|cents|balance)\w*["']?\s+(NUMERIC|DECIMAL|REAL|FLOAT|DOUBLE|numeric|decimal|real|float|double)|float(32|64)\(.*(cents|amount)|f64.*cents|parseFloat\(.*(cents|amount)`
- **Check:** money is BIGINT / int64 cents end to end; fee math is integer (round once, server side).
- **Source:** 4021b68a, 5008c170, 823807c3.

### RC-14 · A public geometry written from the exact coordinate
- **Paths:** `services/**/*.go` `gateway/**/*.go` `database/**`
- **Added:** `approximate_location|service_location|properties\.location|ST_MakePoint|ST_SetSRID|CoarsenPoint|pii_coarsen_point`
- **Check:** points served publicly (`jobs.approximate_location` on the edge-cached `/jobs/map`) are written through `pii_coarsen_point` / `CoarsenPoint`; the three coarsening copies (user, job, `database/cmd/encrypt-pii`) still pass the shared golden vectors in `testdata/geo_coarsen_golden.csv`.
- **Source:** de8b1ef6, 4cc5a58f.

## Gateway, services and engines

### RC-15 · Redis key that can outlive its TTL under volatile-lru
- **Paths:** `gateway/**/*.go` `services/**/*.go` `!**/*_test.go`
- **Added:** `\.(Incr|IncrBy|Decr|DecrBy|SAdd|ZAdd|HSet|HIncrBy|LPush|RPush|SetNX|Expire)\(`
- **Check:** the key gets its TTL in the same atomic step that creates it (Lua / MULTI, or `Set` with an
  expiry). A `DECR` after the window expired recreates the key at -1 with no TTL — use
  `cache.IncrWithTTL` / `cache.DecrIfExists`. Under `volatile-lru` a TTL-less key is never evicted.
- **Source:** #42 / 0aad175a, 16fd42b7.

### RC-16 · Error classified by its text
- **Paths:** `**/*.go` `!**/*_test.go`
- **Added:** `strings\.(Contains|HasPrefix|HasSuffix|EqualFold)\([^)]*\.Error\(\)` `strings\.(Contains|HasPrefix|HasSuffix)\(\s*(msg|errMsg|errStr|message|lower|text)\s*,` `\w+\s*:?=\s*(strings\.ToLower\()?\w*\.Error\(\)`
- **Check:** classify with `errors.As` / `errors.Is` on typed errors (e.g. `*stripe.Error` status 404 /
  `resource_missing`). Context and transport errors (`url.Error`, `net.Error`) mean retry. Error text
  embeds URLs, ports and ids, so a substring like "404" matches by accident.
- **Source:** 12002df8 (a cancelled DELETE to a port containing 404 was recorded as a completed GDPR erasure).

### RC-17 · Response marked publicly cacheable
- **Paths:** `gateway/internal/handler/**` `gateway/internal/router/**` `gateway/internal/middleware/**`
- **Added:** `writeCachedJSON|s-maxage|stale-while-revalidate|Cache-Control`
- **Check:** only anonymous, non-personalized data gets `public, s-maxage`; authed routes keep `private, no-store`; `stale-if-error` stays bounded by `s-maxage`.
- **Source:** 5799c94c, 2f8f7b8b, 4f5cf750.

### RC-18 · Endpoint starts requiring an Idempotency-Key
- **Paths:** `gateway/internal/router/**` `gateway/internal/middleware/**` `gateway/internal/handler/**`
- **Added:** `RequireIdempotencyKey|Idempotency-Key`
- **Check:** every caller sends it — web hooks (`idempotencyHeader`), iOS `APIClient`, `tests/integration`
  suites, k6 scripts — and reuses the same key across retries of one action. Only 2xx responses are
  replayed, so a test that expects a replay must first get a 2xx.
- **Source:** 8363dde2 → f241adbb (Tier-1 double-spend suite 400'd), b976213f, d021588b.

### RC-19 · Gateway starts omitting a field
- **Paths:** `gateway/internal/handler/**/*.go`
- **Added:** `omitempty|if [^{]+ != (0|""|nil) \{`
- **Check:** the web type marks the field optional and every reader has a fallback (`?? 0`); the iOS model decodes it as optional.
- **Source:** 8558aba2 (`snipe_extension_count` omitted at zero → `Math.max(n, undefined)` = NaN on every auction).

### RC-20 · Money path loses its deadline or fails open
- **Paths:** `services/payment/**/*.go` `gateway/internal/middleware/**/*.go` `!**/*_test.go`
- **Added:** `context\.Background\(\)|context\.TODO\(\)|failOpen|fail open|allowOnError|return next`
- **Check:** Stripe and DB calls run under the request context with a bound; idempotency, flags and money engines fail closed (feature flags fail closed in production, SEC-01).
- **Source:** f600a83e, 69fa9ccf, 847bba1f.

### RC-21 · Integration test hangs off a shared hard-coded row
- **Paths:** `**/*_test.go` `tests/integration/**`
- **Added:** `"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"`
- **Check:** `go test ./...` runs package test binaries concurrently against one database — create the
  rows a test owns (and delete them in cleanup); look seeded rows up by slug, not by an id from one
  developer's database.
- **Source:** 7ef664b6 (change-order suites received each other's contracts), f241adbb (literal category UUID).

### RC-22 · Proto contract change
- **Paths:** `proto/**/*.proto`
- **Check:** `make verify-proto` (regenerate + drift + `go vet`); a new `.proto` with a Go consumer is added to the `proto-gen-go` file list in the Makefile; fields are added, never renumbered or removed.
- **Source:** ci.yml `verify-proto` note (audit S8: a Stripe webhook regression hid behind hand-written stand-ins for weeks).

### RC-23 · Dependency manifest change
- **Paths:** `**/go.mod` `**/go.sum` `engines/Cargo.lock` `engines/**/Cargo.toml` `web/package.json` `web/package-lock.json`
- **Check:** run the scanner the Security Gate runs for that ecosystem: `govulncheck ./...` (v1.9.0) in
  the module, `cargo audit` in `engines/`, `npm audit --omit=dev --audit-level=high` in `web/`.
- **Source:** 896df447 … e1915e03, 19191db6, 4865522c, aaa7f8ae.

## Web

### RC-24 · Fonts fetched from Google at build
- **Paths:** `web/**`
- **Added:** `next/font/google|fonts\.googleapis|fonts\.gstatic`
- **Check:** fonts stay self-hosted under `web/src/fonts/`; non-latin subsets stay as on-demand faces with their `unicode-range`.
- **Run:** `node "$RC_TOOLS/checks.mjs" no-google-fonts`
- **Source:** 43a76969, e5369234, 5cae9712 (backendless Playwright webServer timed out waiting on fonts.googleapis.com).

### RC-25 · Build-time URL from an empty env var
- **Paths:** `web/src/**` `deploy/docker/web.Dockerfile`
- **Added:** `new URL\(|NEXT_PUBLIC_SITE_URL|metadataBase`
- **Check:** origins come from `siteUrl()`, which treats empty as unset; prove with `NEXT_PUBLIC_SITE_URL= npm run build`.
- **Run:** `node "$RC_TOOLS/checks.mjs" site-url`
- **Source:** 2f2aa1f3 (`Failed to collect configuration for /_not-found: Invalid URL` in the PR image build).

### RC-26 · Client bundle pulls the schema barrel or classic zod
- **Paths:** `web/src/**`
- **Added:** `from ['"](zod|zod/v[34]|@/lib/validations)['"]`
- **Check:** client code imports `@/lib/schemas/<domain>` and `@/lib/zod-mini`; classic zod only under `app/api/` and `lib/server/`. Then `npm run build && npm run check:bundle`.
- **Run:** `node "$RC_TOOLS/checks.mjs" zod-imports`
- **Source:** 5cb1b698, e6efaae4, 07ea4888 (−14.3 kB gzip on 23 routes).

### RC-27 · Heavy dependency enters a route
- **Paths:** `web/src/**` `web/package.json`
- **Added:** `from ['"](mapbox-gl|@stripe/[a-z-]+|react-grid-layout|qrcode|react-easy-crop|@sentry/[a-z-]+)['"]|next/dynamic`
- **Check:** `npm run build && npm run check:bundle`; report First Load JS before and after for the routes touched. Heavy widgets load with their step via `next/dynamic`.
- **Source:** cf186fab, 42132903, e1c57824, 358001e9 (a duplicated 202 KB Sentry bundle).

### RC-28 · Removed null guard on a field the API may omit
- **Paths:** `web/src/**`
- **Removed:** `\?\?\s|\?\.`
- **Check:** before dropping `?? x` / `?.`, find the gateway serializer and confirm it always sends the field; otherwise keep the guard and mark the type optional. A lint cleanup is not evidence.
- **Source:** 8558aba2 (b6a9e98d's cleanup removed `?? 0`).

### RC-29 · Rejected mutation with no handler
- **Paths:** `web/src/**`
- **Added:** `mutateAsync\(|void handle\w*\(|void \w+Async\(`
- **Check:** an awaited `mutateAsync` has a catch that shows the API's message and keeps the form or dialog state for a retry; a test drives the rejection path.
- **Source:** 0f377408, 6f1beb58.

### RC-30 · Timer started in an effect without cleanup
- **Paths:** `web/src/**`
- **Added:** `setTimeout\(|setInterval\(|requestAnimationFrame\(`
- **Check:** the effect returns a cleanup that clears it; a fake-timer test changes the dependency (speed, pause) and unmounts mid-step.
- **Source:** 856d49f4, 9f7ebcc3.

### RC-31 · External store snapshot keeps its identity
- **Paths:** `web/src/**`
- **Added:** `useSyncExternalStore|getSnapshot`
- **Check:** the snapshot is a new object on every change and the same object between changes, or React never re-renders.
- **Source:** bf26d110.

### RC-32 · Option forwarded as an explicit undefined
- **Paths:** `web/src/hooks/**` `web/src/lib/**`
- **Added:** `\b(retry|staleTime|gcTime|enabled|refetchInterval)\s*:\s*\w+\?\.\w+`
- **Check:** pass an option only when the caller set it; an explicit `undefined` replaces the QueryClient default (`retry: undefined` = three retries on a 403).
- **Source:** 3fcded09.

### RC-33 · Storage write that can be refused
- **Paths:** `web/src/**`
- **Added:** `(localStorage|sessionStorage)\.(setItem|removeItem)|dispatchEvent\(`
- **Check:** with a Storage whose writes throw, the in-memory value survives the sync event and other keys' listeners; a test covers it.
- **Source:** aef1c834, d1f11276.

### RC-34 · UI that picks a role before the viewer is known
- **Paths:** `web/src/**`
- **Added:** `(user\??\.id|userId|viewerId)\s*[!=]==|\.(buyer_id|seller_id|customer_id|provider_id)\s*[!=]==|\bsub\b`
- **Check:** render the loading state until the identity is known — never default to one side's actions; a session without a user id is refused (missing, not only empty).
- **Source:** ee2a88e8, 28d32a5a.

### RC-35 · WebSocket reconnect logic
- **Paths:** `web/src/lib/*websocket*` `web/src/lib/*socket*` `web/src/hooks/*Socket*` `web/src/hooks/*Spectator*`
- **Check:** backoff grows and the attempt cap is reachable (a re-dial must not reset the counter); a rejecting token refresher is handled; run the `auction-websocket.*` unit tests.
- **Source:** 69ec9487, 36664a29, 8d3b16e5.

### RC-36 · Status-to-token mapping
- **Paths:** `web/src/lib/status-badge-classes.ts` `web/src/**/orders/**` `web/src/components/**/StatusBadge*`
- **Added:** `status-|trust-(high|medium|low)|bid-expired|variant`
- **Check:** distinct states keep distinct meanings; run `npx vitest run tests/unit/lib/status-badge-meaning.test.ts`.
- **Source:** 92e36fb0 (refunded shared "pending", high fraud risk shared "disputed").

### RC-37 · Lint passes before build but not after
- **Paths:** `web/src/**`
- **Added:** `Route\s*\|\s*string|as Route|typedRoutes`
- **Check:** run `npm run lint` again after `npm run build` — `.next/types` changes what `Route` resolves to.
- **Source:** 3b3d9977.

### RC-38 · Catalog or page list drift
- **Paths:** `docs/workflows/catalog.yaml` `docs/workflows/generate-catalog.mjs` `web/src/app/**/page.tsx`
- **Check:** catalog.json and pages.json are regenerated and committed.
- **Run:** `make check-catalog`
- **Source:** 7d1762b6 (pages.json silently missed three routes).

### RC-39 · Raw hex colour in a component
- **Paths:** `web/src/components/**` `web/src/app/**`
- **Added:** `#[0-9a-fA-F]{3,8}\b`
- **Check:** semantic tokens only (FE-03).
- **Run:** `node web/scripts/check-no-raw-hex.mjs`
- **Source:** cf154984.

## Tests and test data

### RC-40 · Changing an assertion that already existed
- **Paths:** `web/tests/**` `**/*_test.go` `engines/**/tests/**` `ios/NoMarkupTests/**` `ios/NoMarkupUITests/**`
- **Removed:** `expect\(|assert[._A-Z(]|require\.|XCTAssert|t\.(Errorf|Fatalf|Fatal)\(`
- **Check:** say in the commit whether the old assertion pinned a bug (and which commit fixed it) or the behaviour changed on purpose. Never edit an assertion to match new code without that sentence.
- **Source:** 04fb9da5 (11 tests pinned behaviour fixed by flagged-regressions), f33db384, 31bc6f75.

### RC-41 · Secret-shaped literal in a fixture
- **Added:** `(sk|rk|pk)_(live|test)_[0-9A-Za-z]{8,}|whsec_[0-9A-Za-z]{8,}`
- **Check:** build Stripe-shaped fixtures from parts at runtime; no path is exempted from secret scanning.
- **Run:** `node "$RC_TOOLS/checks.mjs" secret-shapes`
- **Source:** a5096895 (GitGuardian flagged six fixtures on PR #36).

### RC-42 · Test stubs away the branch that crashes
- **Paths:** `web/tests/**` `**/*_test.go`
- **Added:** `mock(Resolved|Return)Value(Once)?\(\s*(\[\]|\{\s*\w+:\s*\[\]\s*\})|questions:\s*\[\]`
- **Check:** at least one test renders the non-empty path through the real component (the stubbed-empty case alone proves nothing).
- **Source:** 3bf00f88 (job form crashed on every category with pre-quote questions; its test stubbed them to `[]`).

### RC-43 · Sleep, retry or skip to make a test pass
- **Paths:** `web/tests/**` `**/*_test.go` `engines/**/*.rs` `ios/NoMarkupTests/**` `ios/NoMarkupUITests/**` `web/playwright.config.ts` `.github/workflows/*.yml` `tests/**`
- **Added:** `\bsleep\s+[0-9]|waitForTimeout\(|time\.Sleep\(|thread::sleep|tokio::time::sleep|Thread\.sleep|\b(test|it|describe)\.(skip|fixme)\(|\bt\.Skip(f|Now)?\(|#\[ignore|XCTSkip|retries:|\.retry\(|Eventually\(`
- **Check:** CLAUDE.md flaky-test policy — fix the root cause or delete the test with the reason
  written down. A skip needs a reason that names the missing precondition, and must not hide a test
  that can never run. In CI scripts, wait on the real probe with a bounded deadline and an error naming
  what never became ready (a `sleep` inside such a loop is fine; a bare one is not).
- **Source:** 69c6cef9 (axe sampled a fading element; fixed by waiting for animations, no rule disabled), f705920c, 12002df8 ("a real defect in the code, not a racy test"), 5f79070d / 309d4497 (readiness probes, never `sleep N`).

## iOS

### RC-44 · Swift API gated on the newest SDK
- **Paths:** `ios/**/*.swift`
- **Added:** `canImport\(|#available|@available`
- **Check:** build the app and test targets with both the local Xcode and CI's; a `canImport` branch that only one Xcode compiles is guarded with `#available` for the deployment target.
- **Source:** dcd62fce.

### RC-45 · xcconfig that the project never reads
- **Paths:** `ios/Config/**` `ios/NoMarkup.xcodeproj/project.pbxproj` `ios/NoMarkup/Info.plist`
- **Check:** each committed xcconfig is referenced and set as a base configuration, so `$(VAR)` in Info.plist expands.
- **Run:** `node "$RC_TOOLS/checks.mjs" xcconfig-wired`
- **Source:** 222f3897 (Stripe / Google / Facebook keys in Info.plist always expanded to empty).
