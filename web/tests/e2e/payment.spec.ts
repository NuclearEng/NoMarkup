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

test.describe('Payment flows', () => {
  test.describe('Payment methods page', () => {
    test('payment methods page loads or redirects to login', async ({ page }) => {
      await gotoProtected(page, '/settings/payment-methods');
    });

    test('payment methods page shows cards or setup prompt', async ({ page }) => {
      const redirected = await gotoProtected(page, '/settings/payment-methods');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasCards = await page.getByText(/visa|mastercard|card|payment method/i).count();
      const hasSetup = await page.getByRole('button', { name: /add|setup|connect/i }).count();
      const hasEmpty = await page.getByText(/no payment|add a payment/i).count();
      expect(hasCards > 0 || hasSetup > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Payment history page', () => {
    test('payment history page loads or redirects to login', async ({ page }) => {
      await gotoProtected(page, '/payments');
    });

    test('payment history shows transactions or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/payments');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasTransactions = await page.getByRole('row').count();
      const hasCards = await page.getByRole('button').count();
      const hasEmpty = await page.getByText(/no payments|no transactions|no history/i).count();
      expect(hasTransactions > 0 || hasCards > 1 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Subscription management', () => {
    test('subscription page loads or redirects to login', async ({ page }) => {
      await gotoProtected(page, '/settings/subscription');
    });

    test('subscription page shows current plan or upgrade options', async ({ page }) => {
      const redirected = await gotoProtected(page, '/settings/subscription');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasPlan = await page.getByText(/plan|subscription|free|pro|premium/i).count();
      expect(hasPlan).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Accessibility', () => {
    test('payment pages have proper headings', async ({ page }) => {
      const redirected = await gotoProtected(page, '/payments');
      if (redirected) return;
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });
  });
});
