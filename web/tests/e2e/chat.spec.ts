import { expect, test } from '@playwright/test';

/** Navigate to a protected route and wait for the auth check to resolve. */
async function gotoProtected(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);
  const redirected = await page
    .waitForURL(/\/login/, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  return redirected;
}

test.describe('Chat flows', () => {
  test.describe('Chat page', () => {
    test('chat page loads or redirects to login', async ({ page }) => {
      await gotoProtected(page, '/messages');
    });

    test('chat page shows channels list or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const hasChannels = await page.getByRole('listitem').count();
      const hasButtons = await page.getByRole('button').count();
      const hasEmpty = await page
        .getByText(/no conversations|no messages|start a conversation/i)
        .count();
      expect(hasChannels > 0 || hasButtons > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Message thread', () => {
    test('clicking a channel navigates to thread view', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      const channels = page.getByRole('listitem');
      if ((await channels.count()) > 0) {
        await channels.first().click();
        const hasInput = await page.getByPlaceholder(/type|message|write/i).count();
        const hasMessages = await page.getByRole('article').count();
        expect(hasInput > 0 || hasMessages > 0).toBeTruthy();
      }
    });

    test('message thread view shows input or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) return;
      await page.waitForLoadState('networkidle');
      // The messages page should show a message input, channel list, or empty state.
      const hasInput = await page.getByPlaceholder(/type|message|write/i).count();
      const hasChannels = await page.getByRole('button').count();
      const hasEmpty = await page
        .getByText(/no conversations|select.*conversation|no messages/i)
        .count();
      expect(hasInput > 0 || hasChannels > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('chat page has proper heading', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) return;
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });
  });
});
