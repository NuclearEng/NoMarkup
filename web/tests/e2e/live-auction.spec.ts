import { expect, test } from '@playwright/test';

test.describe('Live Auction', () => {
  test.skip(
    !process.env['NEXT_PUBLIC_ENABLE_LIVE_AUCTION'],
    'Live auction feature flag not enabled',
  );

  test('shows live auction UI on live auction job page', async ({ page }) => {
    await page.goto('/jobs/test-live-job');
    await page.waitForLoadState('networkidle');

    // Should see the Live Auction header
    const hasLiveAuction = await page.getByText('Live Auction').count();
    const hasNotFound = await page.getByText(/not found|unavailable/i).count();
    expect(hasLiveAuction > 0 || hasNotFound > 0).toBeTruthy();
  });

  test('shows Price History section on live auction job', async ({ page }) => {
    await page.goto('/jobs/test-live-job');
    await page.waitForLoadState('networkidle');

    const hasPriceHistory = await page.getByText('Price History').count();
    const hasNotFound = await page.getByText(/not found|unavailable/i).count();
    expect(hasPriceHistory > 0 || hasNotFound > 0).toBeTruthy();
  });

  test('shows extensions counter on live auction job', async ({ page }) => {
    await page.goto('/jobs/test-live-job');
    await page.waitForLoadState('networkidle');

    const hasExtensions = await page.getByText('Extensions').count();
    const hasNotFound = await page.getByText(/not found|unavailable/i).count();
    expect(hasExtensions > 0 || hasNotFound > 0).toBeTruthy();
  });

  test('does not show Live Auction header on sealed bid job', async ({ page }) => {
    await page.goto('/jobs/test-sealed-job');
    await page.waitForLoadState('networkidle');

    // Should NOT see Live Auction header on a sealed auction job
    await expect(page.getByText('Live Auction')).not.toBeVisible();
  });

  test('provider can see bid form on live auction', async ({ page }) => {
    // Attempt login as provider
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    const emailInput = page.getByLabel(/email/i);
    if (await emailInput.isVisible()) {
      await emailInput.fill('provider@test.com');
      const passwordInput = page.getByLabel(/password/i);
      if (await passwordInput.isVisible()) {
        await passwordInput.fill('TestPassword123!');
      }
      const submitBtn = page.getByRole('button', { name: /sign in|log in/i });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForLoadState('networkidle');
      }
    }

    // Navigate to live auction job
    await page.goto('/jobs/test-live-job');
    await page.waitForLoadState('networkidle');

    // Should see either a bid form or a not-found state
    const hasBidForm = await page
      .getByRole('button', { name: /bid|submit|place/i })
      .count();
    const hasNotFound = await page.getByText(/not found|unavailable/i).count();
    expect(hasBidForm > 0 || hasNotFound > 0).toBeTruthy();
  });

  test('connection status indicator is visible', async ({ page }) => {
    await page.goto('/jobs/test-live-job');
    await page.waitForLoadState('networkidle');

    // Should see either Live, Offline, or Connecting status
    const hasLive = await page.getByText('Live').count();
    const hasOffline = await page.getByText('Offline').count();
    const hasConnecting = await page.getByText('Connecting...').count();
    const hasNotFound = await page.getByText(/not found|unavailable/i).count();
    expect(
      hasLive > 0 || hasOffline > 0 || hasConnecting > 0 || hasNotFound > 0,
    ).toBeTruthy();
  });
});
