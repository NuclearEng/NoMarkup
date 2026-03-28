import { chromium } from '@playwright/test';

/**
 * Pre-warm the Turbopack dev server by visiting key pages in a real browser.
 * Server-side fetch only triggers SSR compilation — this also triggers
 * client-side JS bundling so tests don't hit cold compilation timeouts.
 */
async function globalSetup() {
  const baseURL = 'http://localhost:3000';
  const pages = ['/login', '/register', '/forgot-password', '/reset-password?token=warmup'];

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  for (const path of pages) {
    try {
      await page.goto(path, { timeout: 60_000 });
      // Wait for hydration to trigger full client-side bundle compilation.
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
    } catch {
      // Warmup failure is non-fatal — tests will just be slower.
    }
  }

  await browser.close();
}

export default globalSetup;
