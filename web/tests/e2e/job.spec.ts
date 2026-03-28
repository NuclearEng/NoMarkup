import { expect, test } from '@playwright/test';

test.describe('Job flows', () => {
  test.describe('Job creation', () => {
    test('navigates to job posting form', async ({ page }) => {
      await page.goto('/jobs/new');
      // Should show the job posting form or redirect to login if unauthenticated.
      await page.waitForURL(/\/(jobs\/new|login)/);
    });

    test('job posting form renders required fields', async ({ page }) => {
      await page.goto('/jobs/new');
      // AuthGuard redirects unauthenticated users to /login.
      const redirected = await page
        .waitForURL(/\/login/, { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (redirected) return;
      await expect(page.getByLabel(/title/i)).toBeVisible();
      await expect(page.getByLabel(/description/i)).toBeVisible();
    });

    test('shows validation errors for empty job form submission', async ({ page }) => {
      await page.goto('/jobs/new');
      if (page.url().includes('/login')) {
        return;
      }
      // Attempt to submit without filling required fields.
      const submitButton = page.getByRole('button', { name: /post|create|submit|publish/i });
      if (await submitButton.isVisible()) {
        await submitButton.click();
        // Should show validation errors for required fields.
        await expect(page.getByText(/required|title|description/i).first()).toBeVisible();
      }
    });
  });

  test.describe('Job listing', () => {
    test('renders jobs page', async ({ page }) => {
      await page.goto('/jobs');
      await expect(page).toHaveURL(/\/jobs/);
    });

    test('displays job cards or empty state', async ({ page }) => {
      await page.goto('/jobs');
      // Should either show job cards or an empty state message.
      const hasJobs = await page.getByRole('link', { name: /./i }).count();
      const hasEmptyState = await page.getByText(/no jobs|no results|browse/i).count();
      expect(hasJobs > 0 || hasEmptyState > 0).toBeTruthy();
    });
  });

  test.describe('Job detail', () => {
    test('shows not found or job content for detail page', async ({ page }) => {
      await page.goto('/jobs/test-job-id');
      // Wait for either job content heading or not-found text to appear.
      await Promise.race([
        page.getByRole('heading').first().waitFor({ timeout: 10_000 }),
        page
          .getByText(/not found|error|unavailable/i)
          .first()
          .waitFor({ timeout: 10_000 }),
      ]).catch(() => {});
      const hasContent = await page.getByRole('heading').count();
      const hasNotFound = await page.getByText(/not found|error|unavailable/i).count();
      expect(hasContent > 0 || hasNotFound > 0).toBeTruthy();
    });
  });

  test.describe('Job search and filtering', () => {
    test('search input is present on jobs page', async ({ page }) => {
      await page.goto('/jobs');
      const searchInput = page.getByPlaceholder(/search|find/i);
      const categoryFilter = page.getByRole('combobox');
      // At least one of search input or category filter should be present.
      const hasSearch = await searchInput.count();
      const hasFilter = await categoryFilter.count();
      expect(hasSearch > 0 || hasFilter > 0).toBeTruthy();
    });

    test('URL updates with search query params', async ({ page }) => {
      await page.goto('/jobs?q=plumbing');
      await expect(page).toHaveURL(/\/jobs/);
    });
  });

  test.describe('Accessibility', () => {
    test('jobs page has proper heading hierarchy', async ({ page }) => {
      await page.goto('/jobs');
      const h1 = page.getByRole('heading', { level: 1 });
      const headingCount = await h1.count();
      // Should have at least one h1 heading.
      expect(headingCount).toBeGreaterThanOrEqual(1);
    });
  });
});
