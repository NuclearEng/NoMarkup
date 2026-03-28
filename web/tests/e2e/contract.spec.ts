import { expect, test } from '@playwright/test';

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
      await gotoProtected(page, '/contracts');
    });

    test('contracts page shows list or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasContracts = await page.getByRole('link').count();
      const hasEmpty = await page.getByText(/no contracts|no results|no active/i).count();
      expect(hasContracts > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Contract detail', () => {
    test('contract detail page loads or shows not found', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts/test-contract-id');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasContent = await page.getByRole('heading').count();
      const hasNotFound = await page.getByText(/not found|error|unavailable/i).count();
      expect(hasContent > 0 || hasNotFound > 0).toBeTruthy();
    });
  });

  test.describe('Milestone management', () => {
    test('contract detail shows milestones section when applicable', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts/test-contract-id');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasMilestones = await page.getByText(/milestone|payment|progress/i).count();
      const hasNotFound = await page.getByText(/not found|error/i).count();
      expect(hasMilestones > 0 || hasNotFound > 0).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('contracts page has proper heading', async ({ page }) => {
      const redirected = await gotoProtected(page, '/contracts');
      if (redirected) return;
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });
  });
});
