import { expect, test } from '@playwright/test';

/**
 * Chat smoke E2E. QA-07: no vacuous `expect(a||b||c).toBeTruthy()` —
 * unauthenticated CI asserts login redirect; authenticated asserts Messages
 * heading + conversation list / empty state (not "any button").
 */

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
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) {
        await expect(page).toHaveURL(/\/login/);
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page).toHaveURL(/\/messages/);
      await expect(page.getByRole('heading', { name: /^Messages$/i })).toBeVisible({
        timeout: 10_000,
      });
    });

    test('chat page shows channels list or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /^Messages$/i })).toBeVisible({
        timeout: 10_000,
      });
      // Real chat UI markers — not arbitrary buttons (nav alone would pass).
      const emptyOrPrompt = page.getByText(
        /Select a conversation|No messages yet|start a conversation|no conversations/i,
      );
      const channelRow = page.getByRole('listitem');
      await expect(emptyOrPrompt.or(channelRow).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Message thread', () => {
    test('clicking a channel navigates to thread view', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /^Messages$/i })).toBeVisible({
        timeout: 10_000,
      });
      const channels = page.getByRole('listitem');
      const channelCount = await channels.count();
      if (channelCount === 0) {
        // Empty inbox is a valid authenticated outcome — assert the empty UI.
        await expect(page.getByText(/Select a conversation|No messages yet/i).first()).toBeVisible();
        return;
      }
      await channels.first().click();
      const composer = page.getByPlaceholder(/type|message|write/i);
      const messages = page.getByRole('article');
      await expect(composer.or(messages).first()).toBeVisible({ timeout: 10_000 });
    });

    test('message thread view shows input or empty state', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /^Messages$/i })).toBeVisible({
        timeout: 10_000,
      });
      const composer = page.getByPlaceholder(/type|message|write/i);
      const emptyOrPrompt = page.getByText(
        /Select a conversation|No messages yet|no conversations/i,
      );
      const channelRow = page.getByRole('listitem');
      await expect(composer.or(emptyOrPrompt).or(channelRow).first()).toBeVisible({
        timeout: 15_000,
      });
    });
  });

  test.describe('Accessibility', () => {
    test('chat page has proper heading', async ({ page }) => {
      const redirected = await gotoProtected(page, '/messages');
      if (redirected) {
        await expect(page.getByLabel(/email/i)).toBeVisible();
        return;
      }
      await expect(page.getByRole('heading', { name: /^Messages$/i })).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});
