import { expect, test } from '@playwright/test';

/**
 * Contract smoke E2E. QA-07: login redirect or Contracts heading + list/empty —
 * not "any link || any heading".
 */

/** Navigate to a protected route and wait for the auth check to resolve. */
async function gotoProtected(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);
  const redirected = await page
    .waitForURL(/\/login/, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  return redirected;
}

test.describe('Contract flows', () => {
  test.describe('Contract list', () => {
    test('contracts page loads or redirects to login', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts');
      if (redirected) {
        await expect(page).toHaveURL(/\/login/);
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page).toHaveURL(/\/contracts/);
      await expect(page.getByRole('heading', { name: /Contracts/i })).toBeVisible({
        timeout: 10_000,
      });
    });

    test('contracts page shows list or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /Contracts/i })).toBeVisible({
        timeout: 10_000,
      });
      const empty = page.getByText(/no contracts|no results|no active/i);
      const contractLink = page.locator('a[href*="/contracts/"]');
      await expect(empty.or(contractLink).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Contract detail', () => {
    test('contract detail page loads or shows not found', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts/test-contract-id');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      const notFound = page.getByText(/not found|unavailable|could not be loaded/i);
      const milestones = page.getByText(/milestone|payment schedule|progress/i);
      const contractHeading = page.getByRole('heading').first();
      await expect(notFound.or(milestones).or(contractHeading).first()).toBeVisible({
        timeout: 15_000,
      });
    });
  });

  test.describe('Milestone management', () => {
    test('contract detail shows milestones section when applicable', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts/test-contract-id');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      // Unknown id → not-found is the real outcome; known contract → milestones.
      const notFound = page.getByText(/not found|unavailable|could not be loaded|error/i);
      const milestones = page.getByText(/milestone|payment schedule|progress/i);
      await expect(notFound.or(milestones).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Accessibility', () => {
    test('contracts page has proper heading', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /Contracts/i })).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});
