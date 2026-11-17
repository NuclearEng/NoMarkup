import { chromium, firefox, webkit } from '@playwright/test';

import type { Browser, BrowserType, FullConfig } from '@playwright/test';

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };

/**
 * Launch any installed engine the configured projects use. The warm-up only
 * makes the dev server compile its bundles, which are the same for every
 * engine — but it must not demand an engine the run does not use: the
 * cross-browser CI job installs only `firefox` or `webkit`, and a hard-coded
 * `chromium.launch()` failed it before a single spec ran.
 */
async function launchWarmupBrowser(config: FullConfig): Promise<Browser | null> {
  const names = new Set(config.projects.map((p) => p.use.browserName ?? 'chromium'));
  for (const name of names) {
    const engine = ENGINES[name];
    if (!engine) continue;
    try {
      return await engine.launch();
    } catch {
      // Not installed for this run (e.g. `playwright install firefox` only) — try the next.
    }
  }
  return null;
}

/**
 * Pre-warm the Turbopack dev server by visiting key pages in a real browser.
 * Server-side fetch only triggers SSR compilation — this also triggers
 * client-side JS bundling so tests don't hit cold compilation timeouts.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = 'http://localhost:3000';
  // Warm auth shells plus public/protected routes that axe e2e scans (FE-01).
  // Protected paths redirect unauth → /login (already warmed); still useful so
  // middleware + dashboard layout compile before the first axe test.
  const pages = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password?token=warmup',
    '/',
    '/marketplace',
    '/jobs',
    '/pricing',
    '/dashboard',
    '/settings/security',
  ];

  const browser = await launchWarmupBrowser(config);
  // No engine installed at all: the specs themselves report the missing browser.
  if (!browser) return;
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
