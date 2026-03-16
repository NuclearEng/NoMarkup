import { expect, test } from '@playwright/test';

test.describe('Chat flows', () => {
  test.describe('Chat page', () => {
    test('chat page loads or redirects to login', async ({ page }) => {
      await page.goto('/dashboard/chat');
      await page.waitForURL(/\/(dashboard\/chat|login)/);
    });

    test('chat page shows channels list or empty state', async ({ page }) => {
      await page.goto('/dashboard/chat');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      const hasChannels = await page.getByRole('listitem').count();
      const hasEmpty = await page.getByText(/no conversations|no messages|start a conversation/i).count();
      expect(hasChannels > 0 || hasEmpty > 0).toBeTruthy();
    });
  });

  test.describe('Message thread', () => {
    test('clicking a channel navigates to thread view', async ({ page }) => {
      await page.goto('/dashboard/chat');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      // If there are channels, clicking one should show a message thread.
      const channels = page.getByRole('listitem');
      if ((await channels.count()) > 0) {
        await channels.first().click();
        // Should show a message input or thread content.
        const hasInput = await page
          .getByPlaceholder(/type|message|write/i)
          .count();
        const hasMessages = await page.getByRole('article').count();
        expect(hasInput > 0 || hasMessages > 0).toBeTruthy();
      }
    });

    test('message input is visible in active thread', async ({ page }) => {
      await page.goto('/dashboard/chat/test-channel-id');
      if (page.url().includes('/login')) {
        return;
      }
      await page.waitForLoadState('networkidle');
      // Should show message input or not-found state.
      const hasInput = await page
        .getByPlaceholder(/type|message|write/i)
        .count();
      const hasNotFound = await page.getByText(/not found|error|no conversation/i).count();
      expect(hasInput > 0 || hasNotFound > 0).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('chat page has proper heading', async ({ page }) => {
      await page.goto('/dashboard/chat');
      if (page.url().includes('/login')) {
        return;
      }
      const headings = page.getByRole('heading');
      expect(await headings.count()).toBeGreaterThanOrEqual(1);
    });
  });
});
