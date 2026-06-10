/**
 * Single signal for "full backend stack is present" in E2E runs.
 *
 * Convention (see tests/e2e/dogfood/fixtures.ts): a seeded local stack
 * (`bin/dev` + dev accounts) is announced by setting SEED_PASSWORD in
 * .env.local or the CI environment. When it is unset we are running
 * web-only (Next.js dev server, no gateway on :8080, no DB, no seed
 * accounts) — e.g. the "Playwright E2E Tests" CI job.
 *
 * Specs that log in with seed accounts or assert API-backed content must
 * gate themselves with:
 *
 *   test.skip(!HAS_STACK, NO_STACK_REASON);
 *
 * Specs that work backendless (pure rendering, client-side validation,
 * redirect-to-login assertions) must keep running unconditionally.
 */
export const HAS_STACK = Boolean(process.env['SEED_PASSWORD']);

export const NO_STACK_REASON = 'requires running backend stack (SEED_PASSWORD unset)';
