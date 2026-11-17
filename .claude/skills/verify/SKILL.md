---
name: verify
description: Verify a NoMarkup change before committing it. Runs the fastest reliable checks for the areas the diff touches (web, Go, Rust, migrations, proto, catalog, iOS) with the same commands CI runs, runs the diff-triggered reliability checklist, then runs the change itself (the page in a browser, the endpoint with curl), records what passed so the commit can be stamped Verified-by, and ends with an evidence block. Use before every commit, when asked to "verify", "check this works", "is this ready", or before opening a PR.
---

# Verify a NoMarkup change

Goal: evidence that the change works, gathered as fast as the checks allow — not a full CI rerun. CI
(`.github/workflows/ci.yml`) is the backstop; this skill catches what CI would catch, earlier, plus
what CI cannot (running the change and looking at it).

## 0. What changed

```bash
git fetch -q origin main
git diff --stat origin/main...        # committed on this branch
git status --short                    # staged / unstaged / untracked
```

Group the changed files by area with the table in step 2. Only run the rows that apply.

## 1. Record every check you run

Wrap each check so the commit can be stamped from what actually ran (never from what you type):

```bash
node scripts/verify-record.mjs run --label "<short name>" [--cwd <dir>] -- <command ...>
```

It records only when the command exits 0 **and** leaves the working tree unchanged, keyed to the exact
file contents. Edit a file afterwards and the record no longer covers it — run the check again. With the
opt-in hook (`make install-hooks`) the commit gets `Verified-by: <labels>` or `Verified-by: none`.
`node scripts/verify-record.mjs show` prints what currently covers the staged change.

## 2. Fast checks by area

Run the narrowest command first (one package, one test file), then the module-level one CI runs.

| Area (paths) | Fast first | What CI runs (run before commit) |
|---|---|---|
| **Web** `web/**` | `cd web && npx vitest related --run <changed src files>` | `npm run lint` · `npm run check:hex` · `npm run typecheck` · `npx vitest run <affected test files>` |
| Web routes, pages or imports (`app/**/page.tsx`, new deps, `next/dynamic`, schema imports) | — | `npm run build` then `npm run check:bundle`; run `npm run lint` again after the build (`.next/types` changes `Route`); `make check-catalog` from the root |
| Web coverage-sensitive change (new module, deleted tests) | — | `npm run test -- --coverage` (floors in `web/vitest.config.mts`) |
| **Go** `gateway/**`, `services/<svc>/**`, `pkg/*/**`, `database/**`, `tests/integration/**` | `go test -race -count=1 ./internal/<pkg>/...` | `cd <module> && go vet ./... && go test ./... -race` (gateway and payment: coverage floors via `scripts/check-go-coverage.sh`, 12 and 40) |
| Go touching DB, migrations or handlers | — | `go test -tags integration -short -count=1 ./...` in the module, with `DATABASE_URL` pointing at a migrated and seeded DB (`bin/dev up infra`, `make migrate-up`, `make seed`) |
| Go `go.mod` / `go.sum` | — | `go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...` in that module (Security Gate's version) |
| **Rust** `engines/**` | `cargo test -p <crate>` | `cd engines && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test --all` |
| **Migrations** `database/migrations/**` | `bash scripts/check-migration-sequence.sh` | apply `up`, `down 1`, `up` against a scratch DB: `migrate -path database/migrations -database "$DATABASE_URL" up` |
| **Proto** `proto/**/*.proto` | — | `make verify-proto` |
| **Catalog** `docs/workflows/catalog.yaml`, page files | — | `make check-catalog` |
| **iOS** `ios/**` | build only the scheme | `xcodebuild test -project ios/NoMarkup.xcodeproj -scheme NoMarkup -destination "platform=iOS Simulator,id=<udid>" -only-testing:NoMarkupTests/<TestClass>` |
| **CI workflows** `.github/workflows/**` | read the job you changed end to end | the reliability checklist (step 3) covers runner pins, image names and untested modules |

iOS: one simulator per session — reuse it, address it by id (`xcrun simctl list devices available`),
shut it down when done (`xcrun simctl shutdown <udid>`), keep `-only-testing` narrow, and respect any
machine-wide simulator / build queue. Unit tests do not need UI tests; UI tests need a reason.

## 3. Diff-triggered reliability checklist

```bash
node scripts/reliability-check.mjs --run --record     # or: make reliability-check
```

Prints the `docs/reliability-checklist.md` items this diff triggers (usually 3 to 10) — each one a past
incident — and runs the automatable ones. For every listed item without an automated check, do what its
**Check** says or state why it does not apply. A failing automated check is a failing check (step 5).

## 4. Run the change

Tests passing is not the change working. Exercise the real thing and look at the result:

- **Web page / component:** `cd web && npm run dev` (background; ready on http://localhost:3000). Open
  the changed route in a browser tool and look at it; check loading, error, empty and success states
  where the page fetches data. Without a browser tool:
  `npx playwright screenshot --wait-for-timeout=2000 http://localhost:3000/<route> /tmp/<name>.png`
  and open the image. The pages are backend-tolerant; for real data start the stack (`bin/dev up`).
- **API / gateway / service change:** `bin/dev rebuild <svc> && bin/dev up <svc>` (`bin/dev status` for
  health and ports), then hit the endpoint on :8080 and read status and body:
  `curl -sS -i http://localhost:8080/api/v1/<path>`. For authed routes log in as a seed account
  (`POST /api/v1/auth/login`; the password comes from `SEED_PASSWORD` in `.env.local` — never print it,
  never echo tokens). Show the response for the success case and for one predictable failure (4xx, not 500).
- **Migration:** apply it to the dev DB and query the changed table or constraint.
- **Engine:** run its unit/proptests; for a gRPC contract change, call it through the gateway route that uses it.
- **CI workflow:** after pushing, watch that job's run (`gh run watch` / `gh pr checks`) in the background.

## 5. When a check fails

Fix the cause, then rerun that check (and only then the wider ones). Count rounds per failing check.
**After three rounds that do not make it pass, stop.** Do not retry, skip, add a sleep, loosen an
assertion or widen a threshold to get green (CLAUDE.md flaky-test policy). Hand a human:

- the exact command and the last ~30 lines of its output,
- what you tried in each round and what changed,
- your best hypothesis and what would confirm it.

## 6. Evidence block

End with this, filled in from real output (no check listed that did not run):

```
Verified:
- <label>: <command> -> <pass / result line>
- reliability-check: <N> items triggered (<ids>); automated: <pass/fail>; manual: <what you checked>
- Ran the change: <route or endpoint> -> <what you saw / status + key body field>
Not verified: <what was skipped and why, e.g. "iOS UI tests — no UI change">
```
