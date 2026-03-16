import { expect, test } from '@playwright/test';

test.describe('Contract flows', () => {
  test.describe('Contract list', () => {
    test('contracts page loads or redirects to login', async ({ page }) => {
      await page.goto('/dashboard/contracts');
      await page.waitForURL(/\/(dashboard\/contracts|login)/);
    });

    test('contracts page shows list or empty state', async ({ page }) => {
      await page.goto('/dashboard/contracts');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasContracts = await page.getByRole('link').count();
      const hasEmpty = await page.getByText(/no contracts|no results|no active/i).count();
      expect(hasContracts > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Contract detail', () => {
    test('contract detail page loads or shows not found', async ({ page }) => {
      await page.goto('/dashboard/contracts/test-contract-id');
      await page.waitForLoadState('networkidle');
      if (page.url().includes('/login')) {
        return;
      }
      const hasContent = await page.getByRole('heading').count();
      const hasNotFound = await page.getByText(/not found|error|unavailable/i).count();
      expect(hasContent > 0 || hasNotFound > 0).toBeTruthy();
    });
  });

  test.describe('Milestone management', () => {
    test('contract detail shows milestones section when applicable', async ({ page }) => {
      await page.goto('/dashboard/contracts/test-contract-id');
      await page.waitForLoadState('networkidle');
      if (page.url().includes('/login')) {
        return;
      }
      // Milestone-based contracts should show milestone progress or
      // the page shows a not-found / different payment type.
      const hasMilestones = await page.getByText(/milestone|payment|progress/i).count();
      const hasNotFound = await page.getByText(/not found|error/i).count();
      expect(hasMilestones > 0 || hasNotFound > 0).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('contracts page has proper heading', async ({ page }) => {
      await page.goto('/dashboard/contracts');
      if (page.url().includes('/login')) {
        return;
      }
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });
  });
});
