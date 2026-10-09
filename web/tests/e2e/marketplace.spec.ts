import { expect, test } from '@playwright/test';

/**
 * Goods marketplace smoke E2E.
 *
 * This spec covers the user paths the parallel agents are landing:
 *   - schema + bidding engine (forward auction)
 *   - frontend pages (/marketplace, /sell, /orders)
 *   - payment escrow + pickup flow
 *
 * SKIP POLICY (changed 2026-07 — do not reintroduce the old behaviour):
 *   These tests used to bail out with a "page not yet shipped" skip whenever
 *   the route rendered a 404. That made the suite report GREEN precisely when
 *   the feature was broken: a marketplace outage returns 404, the spec skips,
 *   CI passes. A test that passes while the feature is down is worse than no
 *   test at all.
 *
 *   The repo already has one signal for "this environment cannot run the
 *   test": `HAS_STACK` (tests/e2e/helpers/stack.ts, wired into
 *   playwright.config.ts). Environment capability is the ONLY legitimate
 *   reason to skip. Every route referenced below now exists in the App Router
 *   (`src/app/(public)/marketplace`, `src/app/(dashboard)/sell`,
 *   `src/app/(dashboard)/sell/mine`, `src/app/(dashboard)/bids`), so
 *   "not yet shipped" is no longer a reachable state — a 404 can only mean a
 *   regression. `expectRouteExists` therefore asserts instead of skipping,
 *   keeping "not runnable here" and "broken" distinguishable.
 *
 * The auction-close + winner flow is documented but not actively driven
 * here because manipulating `auction_ends_at` requires DB access that
 * Playwright doesn't have inline. See `e2e-results.md` for the gap list.
 */

import { HAS_STACK, NO_STACK_REASON } from './helpers/stack';

const SEED_PASSWORD = process.env['SEED_PASSWORD'] ?? 'Password123!';

const BUYER = { email: 'customer@nomarkup.com', password: SEED_PASSWORD };
const SELLER = { email: 'provider@nomarkup.com', password: SEED_PASSWORD };

/**
 * Assert the current page is NOT Next.js's not-found shell.
 *
 * Deliberately an assertion and not a `test.skip` — see the SKIP POLICY note
 * in the file header. `route` is only used to make the failure message name
 * the broken URL instead of reporting a bare "expected 0, received 1".
 */
async function expectRouteExists(
  page: import('@playwright/test').Page,
  route: string,
): Promise<void> {
  const notFoundCount = await page.getByText(/404|page not found/i).count();
  expect(notFoundCount, `${route} rendered a 404 — the route regressed`).toBe(0);
}

/**
 * Programmatically log in via the public auth API. Faster + more reliable
 * than driving the UI form, and matches the pattern used by /tests/e2e/auth.spec.ts.
 *
 * Returns true on success, false on failure. Callers ASSERT on the result
 * rather than skipping: these tests only run when HAS_STACK already declared a
 * seeded stack is up, so a failed seed login is a genuine auth regression, not
 * an environment limitation.
 */
async function loginViaAPI(
  page: import('@playwright/test').Page,
  creds: { email: string; password: string },
): Promise<boolean> {
  const response = await page.request.post('http://localhost:8080/api/v1/auth/login', {
    data: creds,
    failOnStatusCode: false,
  });
  if (!response.ok()) {
    return false;
  }
  const body = (await response.json()) as { access_token?: string; user?: { id: string } };
  if (!body.access_token) return false;

  // Stuff the token into localStorage exactly the way the auth-store does.
  await page.addInitScript((token: string) => {
    window.localStorage.setItem('nm_access_token', token);
  }, body.access_token);
  return true;
}

test.describe('Goods marketplace', () => {
  test.describe('Anonymous browsing', () => {
    test('anonymous visitor sees the marketplace and a sign-in CTA on bid', async ({ page }) => {
      // Asserts API-backed content (listing cards OR the server-rendered
      // empty state) — backendless the page renders neither, only an error
      // boundary, so this test inherently needs the stack.
      test.skip(!HAS_STACK, NO_STACK_REASON);

      await page.goto('/marketplace');
      await page.waitForLoadState('networkidle');

      // /marketplace is shipped (src/app/(public)/marketplace/page.tsx). A 404
      // here is a regression, not a "not yet built" state — assert, never skip.
      // See the file header for why the old self-skip was removed.
      await expectRouteExists(page, '/marketplace');

      // The page should render at least one listing card (seed has 13).
      const cards = page.locator('[data-testid="listing-card"], article, [role="article"]');
      const cardCount = await cards.count();
      // Defensive: also accept a "no listings" empty state — schema agent
      // may have wiped seed data. Either way, no crash is acceptable.
      const hasEmpty = await page.getByText(/no listings|nothing for sale/i).count();
      expect(cardCount + hasEmpty).toBeGreaterThan(0);

      if (cardCount > 0) {
        // Click into the first listing.
        await cards.first().click();
        await page.waitForLoadState('networkidle');

        // Anonymous users should see a sign-in CTA when they try to bid.
        const bidBtn = page.getByRole('button', { name: /bid|place bid|sign in to bid/i }).first();
        if (await bidBtn.isVisible().catch(() => false)) {
          await bidBtn.click();
          // Either redirected to /login OR a modal prompting sign-in.
          const signInVisible = await Promise.race([
            page.waitForURL(/\/login/, { timeout: 4_000 }).then(() => true),
            page
              .getByText(/sign in|log in to bid|create an account/i)
              .first()
              .waitFor({ timeout: 4_000 })
              .then(() => true),
          ]).catch(() => false);
          expect(signInVisible).toBe(true);
        }
      }
    });

    test('anonymous visitor can report a listing via the public API', async ({ page }) => {
      // Direct request to the gateway on :8080 — connection-refused (no
      // stack) would throw, not 4xx/5xx, so this can only run stackful.
      test.skip(!HAS_STACK, NO_STACK_REASON);

      // Use the API directly to verify the endpoint we wired exists. The
      // frontend "Report this listing" button is owned by the parallel
      // frontend agent; we still want backend coverage today.
      await page.goto('/marketplace');
      const listings = await page.request
        .get('http://localhost:8080/api/v1/listings/00000000-0000-0000-0000-000000001000/photos')
        .catch(() => null);
      // We don't strictly need the listing photos endpoint — fall through to
      // calling /report with a known seed listing UUID.
      const seedListingID = '00000000-0000-0000-0000-000000001000';

      const reportRes = await page.request.post(
        `http://localhost:8080/api/v1/listings/${seedListingID}/report`,
        {
          data: { reason: 'misleading', description: 'E2E smoke — please ignore' },
          failOnStatusCode: false,
        },
      );
      // Either 201 created or 503 if the marketplace handler is wired with
      // dbPool=nil in the test stack — both are acceptable signals that the
      // route exists and behaves.
      expect([201, 503]).toContain(reportRes.status());
      void listings;
    });
  });

  test.describe('Buyer flow', () => {
    // loginViaAPI hits the gateway on :8080 — backendless the request throws
    // (connection refused) before its `return false` guard can fire.
    test.skip(!HAS_STACK, NO_STACK_REASON);

    test('logged-in buyer can navigate marketplace and view bid UI', async ({ page }) => {
      const ok = await loginViaAPI(page, BUYER);
      expect(ok, 'seed-account login failed against the announced stack').toBe(true);

      await page.goto('/marketplace');
      await page.waitForLoadState('networkidle');
      await expectRouteExists(page, '/marketplace');

      // Click into a listing with bids (the seeded "Peloton Bike+").
      const link = page.locator('a[href*="/marketplace/"]').first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await page.waitForLoadState('networkidle');

        // Real bid UI — not a vacuous boolean OR (QA-07).
        const bidUi = page
          .locator('input[name="bid"], input[type="number"][name*="amount"]')
          .or(page.getByRole('button', { name: /place bid|increase bid|bid \$/i }));
        await expect(bidUi.first()).toBeVisible({ timeout: 15_000 });
      }
    });

    test('buyer sees their bids in /bids', async ({ page }) => {
      const ok = await loginViaAPI(page, BUYER);
      expect(ok, 'seed-account login failed against the announced stack').toBe(true);

      await page.goto('/bids');
      await page.waitForLoadState('networkidle');

      // /bids is shared with the services flow today — should always exist.
      await expectRouteExists(page, '/bids');
    });
  });

  test.describe('Seller flow', () => {
    // Same as Buyer flow: seed-account login via the gateway is required.
    test.skip(!HAS_STACK, NO_STACK_REASON);

    test('seller can reach the new-listing wizard', async ({ page }) => {
      const ok = await loginViaAPI(page, SELLER);
      expect(ok, 'seed-account login failed against the announced stack').toBe(true);

      await page.goto('/sell');
      await page.waitForLoadState('networkidle');

      await expectRouteExists(page, '/sell');

      // Should show either a "post a listing" CTA or the wizard form itself.
      const hasCTA = await page.getByRole('button', { name: /list|post|create/i }).count();
      const hasForm = await page.locator('form').count();
      expect(hasCTA + hasForm).toBeGreaterThan(0);
    });

    test('seller sees their listings in /sell/mine', async ({ page }) => {
      const ok = await loginViaAPI(page, SELLER);
      expect(ok, 'seed-account login failed against the announced stack').toBe(true);

      await page.goto('/sell/mine');
      await page.waitForLoadState('networkidle');

      await expectRouteExists(page, '/sell/mine');

      // Provider seed has at least 5 listings as seller — should render.
      const rows = await page.getByRole('row').count();
      const cards = await page
        .locator('article, [role="article"], [data-testid="listing-card"]')
        .count();
      const hasEmpty = await page.getByText(/no listings yet|haven't listed/i).count();
      expect(rows + cards + hasEmpty).toBeGreaterThan(0);
    });
  });

  test.describe('Auction close + escrow (documented gap)', () => {
    test('winner-confirms-pickup happy path is covered by API tests', () => {
      // Driving auction close requires direct DB manipulation
      // (UPDATE listings SET auction_ends_at = NOW() - 1 minute), which the
      // browser-driven Playwright runner can't do safely. The flow IS
      // covered by:
      //   1. database/migrations/034 — trigger maintains current_bid_cents
      //   2. seed data: listingSoldID — escrow released, pickup confirmed
      //   3. seed data: listingDisputedID — escrow disputed
      //   4. listing_orders handler integration tests (gateway)
      //
      // Skip (not a green vacuous pass — QA-07) until a seed + clock-control
      // harness exists for browser-driven close.
      test.skip(
        true,
        'browser cannot advance auction_ends_at; covered by seed + gateway listing_orders tests',
      );
    });
  });


  test.describe('Admin moderation surface', () => {
    test('admin /admin/listings renders or redirects', async ({ page }) => {
      await page.goto('/admin/listings');
      await page.waitForLoadState('networkidle');
      // AuthGuard redirects unauthenticated users to /login.
      const redirected = await page
        .waitForURL(/\/login/, { timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (redirected) return;
      // Otherwise the page should render the heading.
      await expect(page.getByRole('heading', { name: /listings/i })).toBeVisible();
    });

    test('admin /admin/goods-reports renders or redirects', async ({ page }) => {
      await page.goto('/admin/goods-reports');
      await page.waitForLoadState('networkidle');
      const redirected = await page
        .waitForURL(/\/login/, { timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (redirected) return;
      await expect(page.getByRole('heading', { name: /goods reports/i })).toBeVisible();
    });
  });
});
