/**
 * One-shot Playwright walk of product-gap surfaces against the running stack.
 * Usage: cd web && node scripts/gap-close-screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs/compliance/sim-runs/2026-08-21-gap-close/web');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log('SHOT', path, 'url=', page.url());
}

async function dismissCookies(page) {
  const names = [/accept all/i, /accept cookies/i, /i agree/i, /got it/i];
  for (const name of names) {
    const btn = page.getByRole('button', { name });
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(300);
      return;
    }
  }
}

async function login(page, email) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    // Prefer input[type=...] — OAuth chrome has multiple "email" strings.
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await emailInput.fill('');
    await emailInput.fill(email);
    await passwordInput.fill('');
    await passwordInput.fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    try {
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
      await dismissCookies(page);
      return;
    } catch {
      const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
      if (/rate limit/i.test(body) && attempt < 3) {
        await page.waitForTimeout(Math.min(15_000 + attempt * 10_000, 60_000));
        continue;
      }
      const alert = (await page.getByRole('alert').innerText().catch(() => '')) ?? '';
      if (attempt === 3) {
        throw new Error(`login(${email}) failed: ${(alert || body).slice(0, 240)}`);
      }
      await page.waitForTimeout(1_500 * (attempt + 1));
    }
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20_000);

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' }).catch(() => page.goto(`${BASE}/login`));
  await dismissCookies(page);
  await shot(page, '00-login');

  await login(page, 'customer@nomarkup.com');
  await shot(page, '10-customer-after-login');

  for (const [name, path] of [
    ['11-home', '/'],
    ['12-jobs', '/jobs'],
    ['13-marketplace', '/marketplace'],
    ['14-contracts', '/contracts'],
    ['15-bids', '/bids'],
    ['16-payments', '/payments'],
    ['17-settings-account', '/settings/account'],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await shot(page, name);
  }

  await page.goto(`${BASE}/jobs/00000000-0000-0000-0000-000000000100`, { waitUntil: 'domcontentloaded' });
  await dismissCookies(page);
  await page.waitForTimeout(1200);
  await shot(page, '20-job-detail');

  await page.goto(`${BASE}/marketplace/00000000-0000-0000-0000-000000001000`, { waitUntil: 'domcontentloaded' });
  await dismissCookies(page);
  await page.waitForTimeout(1200);
  await shot(page, '21-listing-detail');

  await page.goto(`${BASE}/marketplace/00000000-0000-0000-0000-000000001000/replay`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot(page, '22-listing-replay');

  await page.goto(`${BASE}/contracts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const contractLink = page.locator('a[href*="/contracts/"]').first();
  if (await contractLink.count()) {
    await contractLink.click();
    await page.waitForTimeout(1500);
    await shot(page, '23-contract-detail');
  }

  // Admin fees — isolated context so the customer session does not leak.
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminContext.newPage();
  await login(adminPage, 'admin@nomarkup.com');
  await shot(adminPage, '30-admin-after-login');
  await adminPage.goto(`${BASE}/admin/payments`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(1500);
  await shot(adminPage, '31-admin-payments');
  await adminPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(1000);
  await shot(adminPage, '32-admin-home');

  await browser.close();
  console.log('DONE', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
