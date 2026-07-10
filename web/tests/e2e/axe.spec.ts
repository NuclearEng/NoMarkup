/**
 * TODO(e2e axe — FE-01): browser-driven accessibility smoke.
 *
 * Vitest + jsdom covers structural axe rules in tests/integration/axe.test.ts
 * but cannot evaluate color-contrast (no real layout/paint). This Playwright
 * suite is the place to re-enable color-contrast against a real page once
 * the local stack (or a preview deploy) is available in CI.
 *
 * Skipped by default so `npm run test:e2e` does not require a live backend
 * for every PR. Flip the skip when E2E_BASE_URL (or the dogfood stack) is up.
 *
 * Suggested expansion:
 *   - /login, /jobs, /marketplace with color-contrast enabled
 *   - axe-playwright or @axe-core/playwright helper
 */

import { test, expect } from '@playwright/test';

const baseURL = process.env['E2E_BASE_URL'] ?? process.env['PLAYWRIGHT_BASE_URL'];

test.describe('axe e2e smoke (TODO — needs live stack)', () => {
  test.skip(!baseURL, 'E2E_BASE_URL / PLAYWRIGHT_BASE_URL not set; skipping real-page axe');

  test('public home has no critical axe violations (placeholder)', async ({ page }) => {
    // When enabled: navigate, inject axe-core, assert zero critical.
    // Placeholder keeps the file valid so Playwright discovers it.
    await page.goto(baseURL ?? 'http://localhost:3000/');
    await expect(page.locator('body')).toBeVisible();
    // TODO: const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    // TODO: expect(results.violations.filter(v => v.impact === 'critical')).toEqual([]);
  });
});
