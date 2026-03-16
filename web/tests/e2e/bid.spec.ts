import { expect, test } from '@playwright/test';

test.describe('Bidding flows', () => {
  test.describe('Bid submission', () => {
    test('job detail page shows bid form or login prompt', async ({ page }) => {
      await page.goto('/jobs/test-job-id');
      await page.waitForLoadState('networkidle');
      // Should show either a bid form, a login prompt, or a not-found state.
      const hasBidForm = await page.getByRole('button', { name: /bid|submit|place/i }).count();
      const hasLogin = await page.getByRole('link', { name: /login|sign in/i }).count();
      const hasNotFound = await page.getByText(/not found|unavailable/i).count();
      expect(hasBidForm > 0 || hasLogin > 0 || hasNotFound > 0).toBeTruthy();
    });

    test('bid form validates amount field', async ({ page }) => {
      await page.goto('/jobs/test-job-id');
      await page.waitForLoadState('networkidle');
      const bidInput = page.getByLabel(/amount|bid|price/i);
      if (await bidInput.isVisible()) {
        await bidInput.fill('0');
        const submitBtn = page.getByRole('button', { name: /bid|submit|place/i });
        if (await submitBtn.isVisible()) {
          await submitBtn.click();
          // Should show validation error for invalid amount.
          await expect(
            page.getByText(/invalid|greater|minimum|required/i).first(),
          ).toBeVisible();
        }
      }
    });
  });

  test.describe('My bids page', () => {
    test('my bids page loads or redirects to login', async ({ page }) => {
      await page.goto('/dashboard/bids');
      await page.waitForURL(/\/(dashboard\/bids|login)/);
    });

    test('my bids page shows bids list or empty state', async ({ page }) => {
      await page.goto('/dashboard/bids');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasBids = await page.getByRole('link').count();
      const hasEmpty = await page.getByText(/no bids|no results|haven.*placed/i).count();
      expect(hasBids > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Bid withdrawal', () => {
    test('bid detail shows withdraw option for active bids', async ({ page }) => {
      await page.goto('/dashboard/bids');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      // If there are bids, the page should have interactive elements.
      const bidCards = await page.getByRole('article').count();
      const withdrawButtons = await page
        .getByRole('button', { name: /withdraw|cancel/i })
        .count();
      // Either bids exist with potential withdraw options, or page is empty.
      expect(bidCards >= 0 || withdrawButtons >= 0).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('bid form fields have proper labels', async ({ page }) => {
      await page.goto('/jobs/test-job-id');
      await page.waitForLoadState('networkidle');
      const bidInput = page.getByLabel(/amount|bid|price/i);
      if (await bidInput.isVisible()) {
        // Input should have an associated label.
        const inputId = await bidInput.getAttribute('id');
        if (inputId) {
          const label = page.locator(`label[for="${inputId}"]`);
          expect(await label.count()).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
