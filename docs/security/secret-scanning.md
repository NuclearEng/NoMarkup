# Secret scanning

GitGuardian scans every pull request through its GitHub integration. This page
is the policy for test fixtures and for findings that are already in git
history.

## Policy

1. **Nothing is exempt from scanning.** Test code is scanned like service
   code. `.gitguardian.yaml` at the repo root ignores no paths and no matches,
   and must not gain a rule for `web/src`, service code or a whole test tree.
2. **A fixture must not look like a live credential to a scanner.** When a
   test needs a value of a particular shape:
   - Build provider-shaped strings from parts at runtime:
     `['pi', '123', 'secret', 'abc'].join('_')` (TypeScript),
     `["seti", "abc123", "secret", "xyz"].joined(separator: "_")` (Swift),
     `"sk_" + "test_" + "…"` (Go).
   - Use an obviously fake constant for passwords, for example
     `test-password-not-real`, and keep it in a named constant instead of next
     to a `password:` key.
   - Do not reuse the local seed default password in a unit test that only
     needs "some password".
3. **A real credential that reaches a commit is rotated first**, then removed.
   Removing it from the tree does not remove it from history.

## Where path exclusions live

`.gitguardian.yaml` is the ggshield configuration file: local scans,
pre-commit hooks and CI jobs that run ggshield read it. GitGuardian's
documentation does not state that the GitHub pull-request check runs read it.
For the GitHub integration the documented controls are:

- **Filepath exclusions** in the GitGuardian workspace: Settings > Secrets
  detection. They can be linked to specific repositories and also apply to
  existing incidents.
- **Resolving the incident** in the dashboard, or the check run's
  "Skip: test credential" / "Skip: false positive" action.

This repo uses neither a workspace exclusion nor an ignore rule for its tests.

## Findings from PR #36 (history)

GitGuardian flagged six values in five test files:

| File | What it was |
|---|---|
| `web/tests/unit/components/contracts/ContractOneShotPay.test.tsx` | Fabricated Stripe-shaped client secrets |
| `web/tests/unit/hooks/useSubscription.gaps.test.ts` | Fabricated Stripe-shaped client secrets |
| `web/tests/unit/lib/validations.forms.test.ts` | A made-up strong password for schema tests |
| `ios/NoMarkupTests/AppConfigTests.swift` | The local-development seed default password, used as a parser input |
| `ios/NoMarkupTests/MoneyFormatTests.swift` | Fabricated Stripe-shaped setup secrets |

All are fixtures; none is a credential for a deployed system. The current tree
no longer contains them in a form a scanner flags. **Git history is not
rewritten**, so the old commits still contain the values and GitGuardian keeps
the incidents open until someone closes them:

- In the GitGuardian dashboard, resolve each of the six incidents as
  **test credential**.

## The local seed default password

`database/cmd/seed` and `database/seed.sql` give every local development
account one well-known password. It is documented in `.env.example`, the
`Makefile` and many pages under `docs/`, and e2e and integration tests log in
with it. It is public by design and is not a secret, **provided no shared
environment was ever seeded with it**:

- The seeder only uses the default when `SEED_ALLOW_DEFAULT_PASSWORD` is not
  switched off and the `DATABASE_URL` host looks local. The host list includes
  `postgres`, the compose service name, which is also the database host in
  `deploy/prod/docker-compose.yml`. Run the seeder against a deployed database
  only with `SEED_PASSWORD` set or `SEED_ALLOW_DEFAULT_PASSWORD=false`.
- If any staging or production database was ever seeded with the default,
  rotate those accounts' passwords.

Scanners will keep flagging this value in files that state it. Resolve those
incidents as test credentials as well.
