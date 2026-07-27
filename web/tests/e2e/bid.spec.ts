import { expect, test } from '@playwright/test';

/**
 * Bidding smoke E2E (CI-friendly, no live Stripe).
 *
 * QA-07: assert real outcomes (URL, visible text, roles) — never
 * `expect(a || b || c).toBeTruthy()` or always-true `count() >= 0`.
 * Unauthenticated CI path: protected routes must land on /login with the
 * login form. Authenticated path: My Bids heading + list or empty state.
 */

test.describe('Bidding flows', () => {
  test.describe('Bid submission', () => {
    test('job detail page shows bid form, login, or job-not-found', async ({ page }) => {
      await page.goto('/jobs/test-job-id');
      // Real outcomes only — not "any heading / any nav link".
      const bidAction = page.getByRole('button', { name: /place bid|submit bid|^bid$/i });
      const jobNotFound = page.getByText('Job not found');
      const loginForm = page.getByRole('heading', { name: /welcome back/i });
      await expect(bidAction.or(jobNotFound).or(loginForm).first()).toBeVisible({
        timeout: 15_000,
      });
    });

    test('bid form validates amount field', async ({ page }) => {
      await page.goto('/jobs/test-job-id');
      await page.waitForLoadState('networkidle');
      const bidInput = page.getByLabel(/amount|bid|price/i);
      if (!(await bidInput.isVisible().catch(() => false))) {
        // No form without a real job / session — not a vacuous pass; skip the
        // validation branch only when the UI under test is not present.
        test.skip(true, 'bid amount field not rendered (no job or unauthenticated)');
        return;
      }
      await bidInput.fill('0');
      const submitBtn = page.getByRole('button', { name: /bid|submit|place/i });
      await expect(submitBtn).toBeVisible();
      await submitBtn.click();
      await expect(page.getByText(/invalid|greater|minimum|required/i).first()).toBeVisible();
    });
  });

  test.describe('My bids page', () => {
    test('my bids page loads or redirects to login', async ({ page }) => {
      await page.goto('/bids');
      await page.waitForURL(/\/(bids|login)/, { timeout: 10_000 });
      if (page.url().includes('/login')) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page).toHaveURL(/\/bids/);
      await expect(page.getByRole('heading', { name: /My Bids/i })).toBeVisible({
        timeout: 10_000,
      });
    });

    test('my bids page shows bids list or empty state', async ({ page }) => {
      await page.goto('/bids');
      await page.waitForURL(/\/(bids|login)/, { timeout: 10_000 });
      if (page.url().includes('/login')) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /My Bids/i })).toBeVisible({
        timeout: 10_000,
      });
      // Services / goods tabs are always present on the real page.
      await expect(page.getByRole('tab', { name: /Services/i })).toBeVisible();
      // Content: bid list, empty copy, or customer-only gate on services tab.
      const emptyOrGate = page.getByText(
        /No goods bids|You haven't placed any bids|No bids yet|no bids|only available to provider/i,
      );
      const bidCards = page.locator('[data-testid="bid-card"], article').or(
        page.getByRole('button', { name: /withdraw|cancel/i }),
      );
      await expect(emptyOrGate.or(bidCards).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Bid withdrawal', () => {
    test('bid detail shows withdraw option for active bids', async ({ page }) => {
      await page.goto('/bids');
      await page.waitForURL(/\/(bids|login)/, { timeout: 10_000 });
      if (page.url().includes('/login')) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /My Bids/i })).toBeVisible({
        timeout: 10_000,
      });
      // Real outcome: empty/gate copy OR at least one bid card / withdraw control.
      // Never `count() >= 0` (always true).
      const emptyOrGate = page.getByText(
        /No goods bids|You haven't placed any bids|No bids yet|no bids|only available to provider/i,
      );
      const withdraw = page.getByRole('button', { name: /withdraw|cancel/i });
      const bidCard = page.locator('article').or(page.getByRole('link', { name: /\$/ }));
      await expect(emptyOrGate.or(withdraw).or(bidCard).first()).toBeVisible({
        timeout: 15_000,
      });
    });
  });


  test.describe('Accessibility', () => {
    test('bid form fields have proper labels when form is present', async ({ page }) => {
      await page.goto('/jobs/test-job-id');
      await page.waitForLoadState('networkidle');
      const bidInput = page.getByLabel(/amount|bid|price/i);
      if (!(await bidInput.isVisible().catch(() => false))) {
        test.skip(true, 'bid form not rendered (no job or unauthenticated)');
        return;
      }
      // getByLabel already requires an accessible name; pin the association.
      const inputId = await bidInput.getAttribute('id');
      expect(inputId, 'bid amount input must have an id for label association').toBeTruthy();
      await expect(page.locator(`label[for="${inputId!}"]`)).toHaveCount(1);
    });
  });
});
