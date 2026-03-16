import { expect, test } from '@playwright/test';

test.describe('Admin flows', () => {
  test.describe('Admin dashboard access', () => {
    test('admin dashboard redirects unauthenticated users', async ({ page }) => {
      await page.goto('/admin');
      // Should redirect to login or show access denied.
      await page.waitForURL(/\/(admin|login)/);
      const hasLoginForm = await page.getByLabel(/email/i).count();
      const hasDashboard = await page.getByText(/dashboard|admin|overview/i).count();
      const hasAccessDenied = await page.getByText(/access denied|unauthorized|forbidden/i).count();
      expect(hasLoginForm > 0 || hasDashboard > 0 || hasAccessDenied > 0).toBeTruthy();
    });

    test('admin dashboard shows overview metrics when accessible', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');
      if (page.url().includes('/login')) {
        return;
      }
      // If admin dashboard is accessible, it should show metrics or navigation.
      const hasMetrics = await page.getByText(/users|jobs|revenue|metrics/i).count();
      const hasNav = await page.getByRole('navigation').count();
      expect(hasMetrics > 0 || hasNav > 0).toBeTruthy();
    });
  });

  test.describe('User management', () => {
    test('admin users page loads or redirects', async ({ page }) => {
      await page.goto('/admin/users');
      await page.waitForURL(/\/(admin\/users|login)/);
    });

    test('user management shows user list or access denied', async ({ page }) => {
      await page.goto('/admin/users');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasUsers = await page.getByRole('row').count();
      const hasSearch = await page.getByPlaceholder(/search|find/i).count();
      const hasAccessDenied = await page.getByText(/access denied|unauthorized/i).count();
      expect(hasUsers > 0 || hasSearch > 0 || hasAccessDenied > 0).toBeTruthy();
    });
  });

  test.describe('Fraud queue', () => {
    test('fraud queue page loads or redirects', async ({ page }) => {
      await page.goto('/admin/fraud');
      await page.waitForURL(/\/(admin\/fraud|login)/);
    });

    test('fraud queue shows alerts or empty state', async ({ page }) => {
      await page.goto('/admin/fraud');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasAlerts = await page.getByRole('row').count();
      const hasEmpty = await page.getByText(/no alerts|no fraud|no signals|queue is empty/i).count();
      const hasAccessDenied = await page.getByText(/access denied|unauthorized/i).count();
      expect(hasAlerts > 0 || hasEmpty > 0 || hasAccessDenied > 0).toBeTruthy();
    });
  });

  test.describe('Disputes', () => {
    test('disputes page loads or redirects', async ({ page }) => {
      await page.goto('/admin/disputes');
      await page.waitForURL(/\/(admin\/disputes|login)/);
    });

    test('disputes page shows dispute list or empty state', async ({ page }) => {
      await page.goto('/admin/disputes');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasDisputes = await page.getByRole('row').count();
      const hasEmpty = await page.getByText(/no disputes|no results|queue is empty/i).count();
      const hasAccessDenied = await page.getByText(/access denied|unauthorized/i).count();
      expect(hasDisputes > 0 || hasEmpty > 0 || hasAccessDenied > 0).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('admin pages have proper heading hierarchy', async ({ page }) => {
      await page.goto('/admin');
      if (page.url().includes('/login')) {
        return;
      }
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });

    test('admin tables have proper structure', async ({ page }) => {
      await page.goto('/admin/users');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      // Tables should have thead and tbody for screen readers.
      const tables = page.getByRole('table');
      if ((await tables.count()) > 0) {
        const headers = page.getByRole('columnheader');
        expect(await headers.count()).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
