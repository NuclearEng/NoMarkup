import { expect, type Page } from '@playwright/test';

import { HAS_STACK, NO_STACK_REASON } from '../helpers/stack';

/* ------------------------------------------------------------------ */
/*  Seed credentials — read from environment variables                */
/*  Set SEED_PASSWORD in .env.local or CI environment                 */
/*                                                                    */
/*  IMPORTANT: this must stay lazy (called inside a test, never at    */
/*  module scope) so importing this file can never break non-dogfood  */
/*  suites. When SEED_PASSWORD is unset, playwright.config.ts ignores */
/*  dogfood/** entirely (`testIgnore`), so the throw below is only    */
/*  reachable if that gate is bypassed — fail loudly in that case.    */
/* ------------------------------------------------------------------ */
function getSeedPassword(): string {
  const pw = process.env['SEED_PASSWORD'];
  if (!pw) {
    throw new Error(
      `Dogfood spec ran without a seeded stack: ${NO_STACK_REASON}. ` +
        'Start the local stack (bin/dev) and set SEED_PASSWORD in .env.local or the CI env.',
    );
  }
  return pw;
}

export { HAS_STACK, NO_STACK_REASON };

const EMAILS = {
  customer: 'customer@nomarkup.com',
  provider: 'provider@nomarkup.com',
  provider2: 'provider2@nomarkup.com',
  admin: 'admin@nomarkup.com',
} as const;

export type Persona = keyof typeof EMAILS;

/* ------------------------------------------------------------------ */
/*  Login helper — fills the login form and waits for dashboard       */
/* ------------------------------------------------------------------ */
export async function loginAs(page: Page, persona: Persona) {
  const email = EMAILS[persona];
  const password = getSeedPassword();

  // UI login with 429 backoff (auth rate limit is per-IP and trips during dense e2e).
  // Prefer input[type=...] over getByLabel — OAuth chrome has multiple "email" strings.
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);

    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await emailInput.fill('');
    await emailInput.fill(email);
    await passwordInput.fill('');
    await passwordInput.fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    try {
      await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
      await page.waitForLoadState('domcontentloaded');
      return;
    } catch {
      const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
      if (/rate limit/i.test(body) && attempt < 5) {
        // Gateway Retry-After is often ~2 min; sleep with progressive backoff.
        const waitMs = Math.min(30_000 + attempt * 20_000, 150_000);
        await page.waitForTimeout(waitMs);
        continue;
      }
      if (attempt === 5) {
        throw new Error(`loginAs(${persona}) failed after retries: ${body.slice(0, 240)}`);
      }
      await page.waitForTimeout(2_000 * (attempt + 1));
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Assertion helpers                                                  */
/* ------------------------------------------------------------------ */

/** Wait for page to settle and verify a page-specific heading is visible. */
export async function expectPageLoaded(page: Page, headingPattern: RegExp) {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: headingPattern }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Navigate to a path. If the app redirects to /login (auth hydration race),
 * re-login and retry the navigation once.
 */
export async function navigateTo(page: Page, path: string, persona?: Persona) {
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  // Give the auth store time to hydrate from the refresh-token cookie.
  await page.waitForTimeout(2_000);

  // If the AuthGuard redirected us to /login, re-login and retry.
  if (page.url().includes('/login') && persona) {
    await loginAs(page, persona);
    await page.goto(path);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
  }
}

/** Verify a page has no fatal error state (only matches HTTP-level errors, not empty states) */
export async function expectNotErrorPage(page: Page) {
  // Only match definitive server error indicators — not generic phrases like
  // "something went wrong" which may appear in legitimate empty states.
  const fatalError = page.locator(
    'text=/^500$/i, text=/Internal Server Error/i, text=/Application error/i',
  );
  const errorCount = await fatalError.count();
  expect(errorCount, 'Page should not show a fatal error state').toBe(0);
}

/** Verify navigation sidebar is present (role=navigation visible — not count >= 1 alone). */
export async function expectNavSidebar(page: Page) {
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 10_000 });
}

export { EMAILS };
export { expect };
