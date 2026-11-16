import { expect, test } from '@playwright/test';

import { HAS_STACK, NO_STACK_REASON } from './helpers/stack';

/**
 * Live Auction E2E.
 *
 * QA-07: do not treat "Job not found" as success for tests named after Live
 * Auction UI. Unknown job IDs assert not-found; real Live Auction chrome is
 * gated on HAS_STACK + the feature flag so a blank/broken page fails.
 */

test.describe('Live Auction', () => {
  test.skip(
    !process.env['NEXT_PUBLIC_ENABLE_LIVE_AUCTION'],
    'Live auction feature flag not enabled',
  );

  test('unknown job id surfaces Job not found (not a blank page)', async ({ page }) => {
    await page.goto('/jobs/test-live-job-missing');
    await expect(page.getByText('Job not found')).toBeVisible({ timeout: 15_000 });
    // Live Auction chrome must not appear on a missing job.
    await expect(page.getByText('Live Auction')).not.toBeVisible();
  });

  test.describe('seeded live auction job', () => {
    // Live Auction UI needs a real job + gateway — not "OR not found".
    test.skip(!HAS_STACK, NO_STACK_REASON);

    test('shows live auction UI on live auction job page', async ({ page }) => {
      await page.goto('/jobs/test-live-job');
      await page.waitForLoadState('networkidle');
      // If the seed job is absent the stack is misconfigured — fail, don't pass.
      await expect(page.getByText('Live Auction')).toBeVisible({ timeout: 15_000 });
    });

    test('shows Price History section on live auction job', async ({ page }) => {
      await page.goto('/jobs/test-live-job');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Price History')).toBeVisible({ timeout: 15_000 });
    });

    test('shows extensions counter on live auction job', async ({ page }) => {
      await page.goto('/jobs/test-live-job');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Extensions')).toBeVisible({ timeout: 15_000 });
    });

    test('connection status indicator is visible', async ({ page }) => {
      await page.goto('/jobs/test-live-job');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Live Auction')).toBeVisible({ timeout: 15_000 });
      // Status chip: Live / Offline / Connecting — one must be present.
      const status = page
        .getByText('Offline', { exact: true })
        .or(page.getByText('Connecting...'))
        .or(page.getByText('Live', { exact: true }));
      await expect(status.first()).toBeVisible({ timeout: 10_000 });
    });

    test('provider can see bid form on live auction', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');
      await page.getByLabel(/email/i).fill('provider@nomarkup.com');
      await page.getByLabel(/password/i).fill(process.env['SEED_PASSWORD'] ?? '');
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

      await page.goto('/jobs/test-live-job');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Live Auction')).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('button', { name: /bid|submit|place/i }).first(),
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  test('does not show Live Auction header on sealed bid job', async ({ page }) => {
    await page.goto('/jobs/test-sealed-job');
    await page.waitForLoadState('networkidle');
    // Missing sealed job → not-found shell, which also must not claim Live Auction.
    await expect(page.getByText('Live Auction')).not.toBeVisible();
  });
});
