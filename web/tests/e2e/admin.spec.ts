import { expect, test } from '@playwright/test';

/**
 * Admin smoke E2E (unauthenticated CI path = login redirect).
 * QA-07: assert URL + login form or admin-specific chrome — never
 * `hasButtons > 1 || hasEmpty` style ORs that pass on any shell.
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

async function expectLoginOr(page: import('@playwright/test').Page, redirected: boolean) {
  if (redirected) {
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel(/email/i)).toBeVisible();
    return true;
  }
  return false;
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
      if (await expectLoginOr(page, redirected)) return;
      // Admin-specific markers — not "any navigation".
      await expect(
        page
          .getByRole('heading', { name: /Admin Overview/i })
          .or(page.getByText('Total Users', { exact: true }))
          .or(page.getByText(/access denied|unauthorized|forbidden/i))
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('User management', () => {
    test('admin users page loads or redirects', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/users');
      if (await expectLoginOr(page, redirected)) return;
      await expect(page).toHaveURL(/\/admin\/users/);
    });

    test('user management shows user list or access denied', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/users');
      if (await expectLoginOr(page, redirected)) return;
      await expect(
        page
          .getByRole('heading', { name: /User Management/i })
          .or(page.getByText(/access denied|unauthorized|forbidden/i))
          .first(),
      ).toBeVisible({ timeout: 15_000 });
      const denied = await page.getByText(/access denied|unauthorized|forbidden/i).count();
      if (denied > 0) return;
      // Table with users, search, or empty admin queue copy.
      const search = page.getByPlaceholder(/search|find/i);
      const rows = page.getByRole('row');
      const empty = page.getByText(/no users|no results|no .* found/i);
      await expect(search.or(rows).or(empty).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Fraud queue', () => {
    test('fraud queue page loads or redirects', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/fraud');
      if (await expectLoginOr(page, redirected)) return;
      await expect(page).toHaveURL(/\/admin\/fraud/);
    });

    test('fraud queue shows alerts or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/fraud');
      if (await expectLoginOr(page, redirected)) return;
      await expect(
        page
          .getByRole('heading', { name: /fraud|alerts|signals/i })
          .or(page.getByText(/access denied|unauthorized|forbidden/i))
          .first(),
      ).toBeVisible({ timeout: 15_000 });
      const denied = await page.getByText(/access denied|unauthorized|forbidden/i).count();
      if (denied > 0) return;
      const empty = page.getByText(
        /no alerts|no fraud|no signals|queue is empty|alerts found|no results/i,
      );
      const rows = page.getByRole('row');
      await expect(empty.or(rows).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Disputes', () => {
    test('disputes page loads or redirects', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/disputes');
      if (await expectLoginOr(page, redirected)) return;
      await expect(page).toHaveURL(/\/admin\/disputes/);
    });

    test('disputes page shows dispute list or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/disputes');
      if (await expectLoginOr(page, redirected)) return;
      await expect(
        page
          .getByRole('heading', { name: /dispute/i })
          .or(page.getByText(/access denied|unauthorized|forbidden/i))
          .first(),
      ).toBeVisible({ timeout: 15_000 });
      const denied = await page.getByText(/access denied|unauthorized|forbidden/i).count();
      if (denied > 0) return;
      const empty = page.getByText(/no disputes|no results|queue is empty|disputes found/i);
      const rows = page.getByRole('row');
      await expect(empty.or(rows).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Accessibility', () => {
    test('admin pages have proper heading hierarchy', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin');
      if (await expectLoginOr(page, redirected)) return;
      // Page-specific heading — not "any heading" (QA-07).
      await expect(
        page.getByRole('heading', { name: /Admin Overview/i }).first(),
      ).toBeVisible({ timeout: 10_000 });
    });

    test('admin tables have proper structure', async ({ page }) => {
      const redirected = await gotoProtected(page, '/admin/users');
      if (await expectLoginOr(page, redirected)) return;
      await page.waitForLoadState('networkidle');
      const tables = page.getByRole('table');
      if ((await tables.count()) === 0) {
        // Empty / denied without a table — still must not be a blank shell.
        await expect(
          page
            .getByRole('heading', { name: /User Management/i })
            .or(page.getByText(/access denied|unauthorized|forbidden/i))
            .first(),
        ).toBeVisible();
        return;
      }
      await expect(page.getByRole('columnheader').first()).toBeVisible();
    });
  });
});
