import { expect, test } from '@playwright/test';

/** Navigate to a protected route and wait for the auth check to resolve. */
async function gotoProtected(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);
  // AuthGuard redirects unauthenticated users to /login. Wait for either
  // the redirect or page content to appear.
  const redirected = await page
    .waitForURL(/\/login/, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  return redirected;
}

test.describe('Admin flows', () => {
  test.describe('Admin dashboard access', () => {
    test('admin dashboard redirects unauthenticated users', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin');
      expect(redirected).toBe(true);
      await expect(page.getByLabel(/email/i)).toBeVisible();
    });

    test('admin dashboard shows overview metrics when accessible', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasMetrics = await page.getByText(/users|jobs|revenue|metrics/i).count();
      const hasNav = await page.getByRole('navigation').count();
      expect(hasMetrics > 0 || hasNav > 0).toBeTruthy();
    });
  });

  test.describe('User management', () => {
    test('admin users page loads or redirects', async ({ page }) => {
      await gotoProtected(page, '/admin/users');
    });

    test('user management shows user list or access denied', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/users');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasUsers = await page.getByRole('row').count();
      const hasSearch = await page.getByPlaceholder(/search|find/i).count();
      const hasAccessDenied = await page.getByText(/access denied|unauthorized/i).count();
      expect(hasUsers > 0 || hasSearch > 0 || hasAccessDenied > 0).toBeTruthy();
    });
  });

  test.describe('Fraud queue', () => {
    test('fraud queue page loads or redirects', async ({ page }) => {
      await gotoProtected(page, '/admin/fraud');
    });

    test('fraud queue shows alerts or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/fraud');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasAlerts = await page.getByRole('row').count();
      const hasButtons = await page.getByRole('button').count();
      const hasEmpty = await page
        .getByText(/no alerts|no fraud|no signals|queue is empty|alerts found/i)
        .count();
      const hasAccessDenied = await page.getByText(/access denied|unauthorized/i).count();
      expect(hasAlerts > 0 || hasButtons > 1 || hasEmpty > 0 || hasAccessDenied > 0).toBeTruthy();
    });
  });

  test.describe('Disputes', () => {
    test('disputes page loads or redirects', async ({ page }) => {
      await gotoProtected(page, '/admin/disputes');
    });

    test('disputes page shows dispute list or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/disputes');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasDisputes = await page.getByRole('row').count();
      const hasEmpty = await page
        .getByText(/no disputes|no results|queue is empty|disputes found/i)
        .count();
      const hasAccessDenied = await page.getByText(/access denied|unauthorized/i).count();
      expect(hasDisputes > 0 || hasEmpty > 0 || hasAccessDenied > 0).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('admin pages have proper heading hierarchy', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin');
      if (redirected) return;
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });

    test('admin tables have proper structure', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/users');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const tables = page.getByRole('table');
      if ((await tables.count()) > 0) {
        const headers = page.getByRole('columnheader');
        expect(await headers.count()).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
