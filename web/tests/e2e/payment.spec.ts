import { expect, test } from '@playwright/test';

test.describe('Payment flows', () => {
  test.describe('Payment methods page', () => {
    test('payment methods page loads or redirects to login', async ({ page }) => {
      await page.goto('/dashboard/payments/methods');
      await page.waitForURL(/\/(dashboard\/payments|login)/);
    });

    test('payment methods page shows cards or setup prompt', async ({ page }) => {
      await page.goto('/dashboard/payments/methods');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasCards = await page.getByText(/visa|mastercard|card|payment method/i).count();
      const hasSetup = await page
        .getByRole('button', { name: /add|setup|connect/i })
        .count();
      const hasEmpty = await page.getByText(/no payment|add a payment/i).count();
      expect(hasCards > 0 || hasSetup > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Payment history page', () => {
    test('payment history page loads or redirects to login', async ({ page }) => {
      await page.goto('/dashboard/payments');
      await page.waitForURL(/\/(dashboard\/payments|login)/);
    });

    test('payment history shows transactions or empty state', async ({ page }) => {
      await page.goto('/dashboard/payments');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasTransactions = await page.getByRole('row').count();
      const hasEmpty = await page.getByText(/no payments|no transactions|no history/i).count();
      expect(hasTransactions > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Subscription management', () => {
    test('subscription page loads or redirects to login', async ({ page }) => {
      await page.goto('/dashboard/subscription');
      await page.waitForURL(/\/(dashboard\/subscription|login)/);
    });

    test('subscription page shows current plan or upgrade options', async ({ page }) => {
      await page.goto('/dashboard/subscription');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasPlan = await page.getByText(/plan|subscription|free|pro|premium/i).count();
      expect(hasPlan).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Accessibility', () => {
    test('payment pages have proper headings', async ({ page }) => {
      await page.goto('/dashboard/payments');
      if (page.url().includes('/login')) {
        return;
      }
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });
  });
});
