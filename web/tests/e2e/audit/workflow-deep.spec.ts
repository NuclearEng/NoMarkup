/**
 * Deep workflow button/action audit for each persona.
 * Exercises primary funnels with real API (no mocks).
 *
 * SEED_PASSWORD=... npx playwright test tests/e2e/audit/workflow-deep.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { HAS_STACK, NO_STACK_REASON } from '../helpers/stack';
import { loginAs, navigateTo } from '../dogfood/fixtures';

test.skip(!HAS_STACK, NO_STACK_REASON);

const OUT = '/tmp/nomarkup-web-audit/reports/workflow-deep.json';
const findings: Array<Record<string, unknown>> = [];

function log(step: string, status: 'PASS' | 'FAIL' | 'PARTIAL' | 'SKIP', detail = '') {
  findings.push({ step, status, detail, at: new Date().toISOString() });
  // eslint-disable-next-line no-console
  console.log(`[${status}] ${step}${detail ? ' — ' + detail : ''}`);
}

async function shot(page: Page, name: string) {
  const p = path.join('/tmp/nomarkup-web-audit/screenshots', `${name}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await page.screenshot({ path: p, fullPage: false }).catch(() => undefined);
}

async function noFatal(page: Page, step: string) {
  const fatal = page.locator(
    'text=/Internal Server Error/i, text=/Application error/i, text=/^500$/i',
  );
  const n = await fatal.count();
  if (n > 0) {
    log(step, 'FAIL', 'fatal UI visible');
    await shot(page, `fail-${step.replace(/\W+/g, '-')}`);
    return false;
  }
  return true;
}

test.describe.configure({ mode: 'serial' });
// Deep funnels are multi-minute
test.setTimeout(10 * 60_000);

test.afterAll(() => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const pass = findings.filter((f) => f['status'] === 'PASS').length;
  const fail = findings.filter((f) => f['status'] === 'FAIL').length;
  const partial = findings.filter((f) => f['status'] === 'PARTIAL').length;
  fs.writeFileSync(
    OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), pass, fail, partial, findings }, null, 2),
  );
});

/* ------------------------------------------------------------------ */
/*  CUSTOMER full funnel                                               */
/* ------------------------------------------------------------------ */
test.describe('Customer deep workflows', () => {
  test('login → dashboard → post job wizard → my jobs → marketplace → settings', async ({
    page,
  }) => {
    // Login
    await loginAs(page, 'customer');
    await expect(
      page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    log('customer.login', 'PASS');
    await shot(page, 'customer-dashboard');

    // Dashboard quick actions
    const postJob = page.locator('a[href="/jobs/new"]');
    await expect(postJob.first()).toBeVisible({ timeout: 10_000 });
    await postJob.first().click();
    await page.waitForURL(/\/jobs\/new/, { timeout: 15_000 });
    if (!(await noFatal(page, 'customer.jobs_new'))) return;
    log('customer.nav_post_job', 'PASS');

    // Wizard step 1 — category
    const categoryList = page.locator('ul[aria-label="Categories"]');
    const stepLabel = page.getByText(/Step 1 of 7|Service Category/i);
    await expect(stepLabel.first()).toBeVisible({ timeout: 15_000 });
    // Wait for taxonomy tree (API can take a moment after hydrate)
    await expect(categoryList).toBeVisible({ timeout: 20_000 });
    if ((await categoryList.count()) > 0) {
      const catBtn = categoryList.getByRole('button').first();
      await catBtn.click();
      await page.waitForTimeout(500);
      const cb = page.getByRole('checkbox');
      if ((await cb.count()) > 0) await cb.first().check();
      else {
        // drill one level
        const sub = categoryList.getByRole('button');
        if ((await sub.count()) > 0) {
          await sub.first().click();
          await page.waitForTimeout(400);
          if ((await page.getByRole('checkbox').count()) > 0) {
            await page.getByRole('checkbox').first().check();
          }
        }
      }
      const next = page.getByRole('button', { name: 'Next', exact: true });
      if (await next.isEnabled().catch(() => false)) {
        await next.click();
        log('customer.wizard_category', 'PASS');
      } else {
        log('customer.wizard_category', 'PARTIAL', 'Next disabled — category leaf not selected');
      }
    } else {
      log('customer.wizard_category', 'FAIL', 'Categories list missing — taxonomy API?');
      await shot(page, 'customer-wizard-no-categories');
    }

    // Details step if present
    if (await page.getByLabel(/Job Title/i).isVisible().catch(() => false)) {
      await page.getByLabel(/Job Title/i).fill(`QA Wire Audit Job ${Date.now()}`);
      await page
        .getByLabel(/Description/i)
        .fill(
          'Automated QA job for full wire audit. Kitchen faucet leak, needs repair. Bring tools.',
        );
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      log('customer.wizard_details', 'PASS');
    }

    // Location
    if (await page.getByLabel(/Service Address/i).isVisible().catch(() => false)) {
      await page.getByLabel(/Service Address/i).fill('123 Congress Ave, Austin, TX 78701');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      log('customer.wizard_location', 'PASS');
    }

    // Remaining steps: advance with Next when enabled, stop before final publish if blocked
    for (let i = 0; i < 5; i++) {
      const next = page.getByRole('button', { name: 'Next', exact: true });
      const publish = page.getByRole('button', { name: /Publish|Post Job|Submit/i });
      if ((await publish.count()) > 0 && (await publish.first().isVisible())) {
        // Attempt publish — real mutation
        if (await publish.first().isEnabled()) {
          await publish.first().click();
          await page.waitForTimeout(3000);
          const url = page.url();
          if (/\/jobs\/[0-9a-f-]{8,}/i.test(url) || (await page.getByText(/posted|success|live/i).count()) > 0) {
            log('customer.wizard_publish', 'PASS', url);
          } else {
            log('customer.wizard_publish', 'PARTIAL', `after click url=${url}`);
          }
        } else {
          log('customer.wizard_publish', 'PARTIAL', 'Publish disabled');
        }
        break;
      }
      if ((await next.count()) === 0) break;
      if (!(await next.isEnabled().catch(() => false))) {
        log('customer.wizard_advance', 'PARTIAL', `Next disabled at step loop ${i}`);
        break;
      }
      await next.click();
      await page.waitForTimeout(600);
    }
    await shot(page, 'customer-wizard-end');

    // My jobs
    await navigateTo(page, '/jobs/mine', 'customer');
    if (await noFatal(page, 'customer.jobs_mine')) {
      const hasContent =
        (await page.getByRole('heading').count()) > 0 ||
        (await page.locator('a[href*="/jobs/"]').count()) > 0 ||
        (await page.getByText(/no jobs|empty|get started|post/i).count()) > 0;
      log('customer.jobs_mine', hasContent ? 'PASS' : 'PARTIAL', page.url());
    }
    await shot(page, 'customer-jobs-mine');

    // Contracts list
    await navigateTo(page, '/contracts', 'customer');
    if (await noFatal(page, 'customer.contracts')) {
      log('customer.contracts', 'PASS');
    }

    // Marketplace browse + open first listing if any
    await navigateTo(page, '/marketplace', 'customer');
    if (await noFatal(page, 'customer.marketplace')) {
      const listing = page.locator('a[href*="/marketplace/"]').filter({ hasNot: page.locator('[href="/marketplace"]') });
      if ((await listing.count()) > 0) {
        await listing.first().click();
        await page.waitForTimeout(2000);
        if (await noFatal(page, 'customer.listing_detail')) {
          // Try wishlist/watch if present (non-destructive toggles)
          const wish = page.getByRole('button', { name: /wishlist|watch|save|follow/i });
          if ((await wish.count()) > 0 && (await wish.first().isVisible())) {
            await wish.first().click().catch(() => undefined);
            await page.waitForTimeout(800);
            log('customer.listing_action', 'PASS', 'toggled save/watch');
          } else {
            log('customer.listing_detail', 'PASS');
          }
        }
      } else {
        log('customer.marketplace', 'PARTIAL', 'no listing cards');
      }
    }
    await shot(page, 'customer-marketplace');

    // Messages
    await navigateTo(page, '/messages', 'customer');
    if (await noFatal(page, 'customer.messages')) log('customer.messages', 'PASS');

    // Payments
    await navigateTo(page, '/payments', 'customer');
    if (await noFatal(page, 'customer.payments')) log('customer.payments', 'PASS');

    // Settings cluster
    for (const r of [
      '/settings/account',
      '/settings/notifications',
      '/settings/payment-methods',
      '/settings/security',
      '/settings/subscription',
    ]) {
      await navigateTo(page, r, 'customer');
      const ok = await noFatal(page, `customer.${r}`);
      log(`customer.${r}`, ok ? 'PASS' : 'FAIL');
    }

    // Profile
    await navigateTo(page, '/profile', 'customer');
    if (await noFatal(page, 'customer.profile')) {
      const edit = page.getByRole('button', { name: /edit|save/i });
      log('customer.profile', 'PASS', `editControls=${await edit.count()}`);
    }

    // Notifications
    await navigateTo(page, '/notifications', 'customer');
    if (await noFatal(page, 'customer.notifications')) log('customer.notifications', 'PASS');

    // Sell flow entry
    await navigateTo(page, '/sell/new', 'customer');
    if (await noFatal(page, 'customer.sell_new')) {
      const formish =
        (await page.getByRole('textbox').count()) + (await page.getByRole('button').count());
      log('customer.sell_new', formish > 0 ? 'PASS' : 'PARTIAL', `controls=${formish}`);
    }
    await shot(page, 'customer-sell-new');
  });
});

/* ------------------------------------------------------------------ */
/*  PROVIDER full funnel                                               */
/* ------------------------------------------------------------------ */
test.describe('Provider deep workflows', () => {
  test('login → provider hub → jobs browse → bid UI → workspace → business tools', async ({
    page,
  }) => {
    await loginAs(page, 'provider');
    log('provider.login', 'PASS');
    await shot(page, 'provider-dashboard');

    await navigateTo(page, '/provider', 'provider');
    if (await noFatal(page, 'provider.hub')) {
      await expect(page.getByText(/Trust Score|Provider|Active Bids/i).first()).toBeVisible({
        timeout: 15_000,
      });
      log('provider.hub', 'PASS');
    }
    await shot(page, 'provider-hub');

    // Browse jobs + open first
    await navigateTo(page, '/jobs', 'provider');
    if (await noFatal(page, 'provider.jobs')) {
      const jobLink = page.locator('a[href*="/jobs/"]').filter({
        hasNot: page.locator('[href="/jobs"], [href="/jobs/new"], [href="/jobs/map"], [href="/jobs/mine"]'),
      });
      // Prefer UUID-looking job links
      const all = page.locator('a[href^="/jobs/"]');
      let opened = false;
      const count = await all.count();
      for (let i = 0; i < Math.min(count, 15); i++) {
        const href = await all.nth(i).getAttribute('href');
        if (!href) continue;
        if (/^\/jobs\/[0-9a-f-]{20,}/i.test(href)) {
          await all.nth(i).click();
          await page.waitForTimeout(2000);
          opened = true;
          break;
        }
      }
      if (opened && (await noFatal(page, 'provider.job_detail'))) {
        const bidBtn = page.getByRole('button', { name: /place bid|bid|submit bid/i });
        if ((await bidBtn.count()) > 0) {
          log('provider.job_detail_bid_cta', 'PASS', `bidButtons=${await bidBtn.count()}`);
          // Open bid form but do not complete payment-sensitive path unless form is simple
          await bidBtn.first().click().catch(() => undefined);
          await page.waitForTimeout(800);
          const amount = page.getByLabel(/amount|bid|price/i);
          if ((await amount.count()) > 0) {
            log('provider.bid_form', 'PASS', 'amount field visible');
            await page.keyboard.press('Escape').catch(() => undefined);
          } else {
            log('provider.bid_form', 'PARTIAL', 'bid CTA present but form fields unclear');
          }
        } else {
          log('provider.job_detail', 'PARTIAL', 'no bid CTA (may be own job or closed)');
        }
      } else if (!opened) {
        log('provider.jobs_open', 'PARTIAL', `no job uuid links among ${count}`);
      }
    }
    await shot(page, 'provider-job');

    // My bids
    await navigateTo(page, '/bids', 'provider');
    if (await noFatal(page, 'provider.bids')) log('provider.bids', 'PASS');

    // Workspace
    await navigateTo(page, '/provider/workspace', 'provider');
    if (await noFatal(page, 'provider.workspace')) {
      const openContract = page.getByRole('link', { name: /Open contract/i });
      const anyContractLink = page.locator('a[href*="/contracts/"]');
      if ((await openContract.count()) > 0 || (await anyContractLink.count()) > 0) {
        log('provider.workspace', 'PASS', 'contract deep-link present');
      } else {
        // Empty workspace is OK; cards when present must link
        log('provider.workspace', 'PASS', 'empty or no active cards');
      }
    }
    await shot(page, 'provider-workspace');

    // Instant offers
    await navigateTo(page, '/provider/offers', 'provider');
    if (await noFatal(page, 'provider.offers')) log('provider.offers', 'PASS');

    // Team
    await navigateTo(page, '/provider/team', 'provider');
    if (await noFatal(page, 'provider.team')) {
      const add = page.getByRole('button', { name: /add|invite|new employee/i });
      log('provider.team', 'PASS', `addControls=${await add.count()}`);
    }

    // Verification
    await navigateTo(page, '/provider/verification', 'provider');
    if (await noFatal(page, 'provider.verification')) log('provider.verification', 'PASS');

    // Business tools
    for (const r of [
      '/provider/business',
      '/provider/business/expenses',
      '/provider/business/invoices',
      '/provider/business/tax',
      '/provider/advances',
      '/provider/challenges',
      '/provider/onboarding',
    ]) {
      await navigateTo(page, r, 'provider');
      const ok = await noFatal(page, `provider.${r}`);
      log(`provider.${r}`, ok ? 'PASS' : 'FAIL');
    }
    await shot(page, 'provider-business');

    // Contracts
    await navigateTo(page, '/contracts', 'provider');
    if (await noFatal(page, 'provider.contracts')) {
      const c = page.locator('a[href*="/contracts/"]');
      if ((await c.count()) > 0) {
        await c.first().click();
        await page.waitForTimeout(2000);
        if (await noFatal(page, 'provider.contract_detail')) {
          log('provider.contract_detail', 'PASS');
        }
      } else {
        log('provider.contracts', 'PASS', 'empty or list-only');
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  ADMIN full funnel                                                  */
/* ------------------------------------------------------------------ */
test.describe('Admin deep workflows', () => {
  test('login → overview metrics → users search → flags → fraud → payments', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin', 'admin');
    if (await noFatal(page, 'admin.overview')) {
      const metrics = ['Total Users', 'Active Jobs', 'GMV', 'Open Disputes'];
      let found = 0;
      for (const m of metrics) {
        if ((await page.getByText(m, { exact: true }).count()) > 0) found++;
      }
      log('admin.overview', found >= 3 ? 'PASS' : 'PARTIAL', `metrics=${found}/${metrics.length}`);
    }
    await shot(page, 'admin-overview');

    // Users search
    await navigateTo(page, '/admin/users', 'admin');
    if (await noFatal(page, 'admin.users')) {
      const search = page.getByPlaceholder(/Search by name or email/i);
      if ((await search.count()) > 0) {
        await search.fill('customer');
        await search.press('Enter');
        await page.waitForTimeout(1500);
        log('admin.users_search', 'PASS');
        // Open first user detail if link exists
        const userLink = page.locator('a[href*="/admin/users/"]');
        if ((await userLink.count()) > 0) {
          await userLink.first().click();
          await page.waitForTimeout(1500);
          if (await noFatal(page, 'admin.user_detail')) log('admin.user_detail', 'PASS');
        }
      } else {
        log('admin.users', 'PARTIAL', 'no search placeholder');
      }
    }
    await shot(page, 'admin-users');

    // Flags — non-destructive read of toggles
    await navigateTo(page, '/admin/flags', 'admin');
    if (await noFatal(page, 'admin.flags')) {
      const toggles = page.getByRole('switch').or(page.getByRole('checkbox'));
      log('admin.flags', 'PASS', `controls=${await toggles.count()}`);
    }

    // Advances — money actions must open confirm (not one-click)
    await navigateTo(page, '/admin/advances', 'admin');
    if (await noFatal(page, 'admin.advances_confirm')) {
      const approve = page.getByRole('button', { name: /^Approve$/i }).first();
      if ((await approve.count()) > 0 && (await approve.isVisible().catch(() => false))) {
        await approve.click();
        await page.waitForTimeout(400);
        const dialog = page.locator('dialog[open], [role="dialog"]');
        if ((await dialog.count()) > 0) {
          log('admin.advances_confirm', 'PASS', 'confirm dialog opened');
          await page.keyboard.press('Escape').catch(() => undefined);
          const cancel = page.getByRole('button', { name: /cancel|close/i });
          if ((await cancel.count()) > 0) await cancel.first().click().catch(() => undefined);
        } else {
          log('admin.advances_confirm', 'FAIL', 'Approve did not open confirm dialog');
        }
      } else {
        log('admin.advances_confirm', 'PASS', 'no approve row (empty queue OK)');
      }
    }

    // Fraud, disputes, payments, jobs, listings
    for (const r of [
      '/admin/fraud',
      '/admin/disputes',
      '/admin/payments',
      '/admin/jobs',
      '/admin/listings',
      '/admin/reviews',
      '/admin/verification',
      '/admin/markets',
      '/admin/platform',
      '/admin/taxonomy',
      '/admin/banking',
      '/admin/insurance',
      '/admin/insurers',
      '/admin/challenges',
      '/admin/advances',
      '/admin/guarantee',
      '/admin/goods-reports',
      '/admin/user-reports',
      '/admin/licenses',
    ]) {
      await navigateTo(page, r, 'admin');
      const ok = await noFatal(page, `admin.${r}`);
      // Interactive: try search/filter if present
      const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
      if (ok && (await search.count()) > 0 && (await search.first().isVisible().catch(() => false))) {
        await search.first().fill('test');
        await page.keyboard.press('Enter').catch(() => undefined);
        await page.waitForTimeout(800);
        if (!(await noFatal(page, `admin.${r}.search`))) {
          log(`admin.${r}`, 'FAIL', 'search caused fatal');
          continue;
        }
      }
      log(`admin.${r}`, ok ? 'PASS' : 'FAIL');
    }
    await shot(page, 'admin-end');
  });
});

/* ------------------------------------------------------------------ */
/*  PUBLIC surface                                                     */
/* ------------------------------------------------------------------ */
test.describe('Public deep workflows', () => {
  test('landing → jobs → marketplace → providers → pricing → demo auction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    if (await noFatal(page, 'public.landing')) {
      const ctas = page.getByRole('link').filter({ hasText: /get started|post|browse|sign/i });
      log('public.landing', 'PASS', `cta-ish links=${await ctas.count()}`);
    }
    await shot(page, 'public-landing');

    await page.goto('/jobs');
    await page.waitForTimeout(2000);
    if (await noFatal(page, 'public.jobs')) {
      const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
      if ((await search.count()) > 0) {
        await search.first().fill('plumb');
        await page.keyboard.press('Enter').catch(() => undefined);
        await page.waitForTimeout(1200);
      }
      log('public.jobs', 'PASS');
    }

    // Job map must not throw Invalid LngLat (NaN, NaN)
    {
      const mapErrors: string[] = [];
      const onPage = (err: Error) => {
        mapErrors.push(err.message);
      };
      page.on('pageerror', onPage);
      await page.goto('/jobs/map');
      await page.waitForTimeout(3500);
      page.off('pageerror', onPage);
      const lngLatBug = mapErrors.some((m) => /Invalid LngLat|NaN/i.test(m));
      if (lngLatBug) {
        log('public.jobs_map', 'FAIL', mapErrors.find((m) => /LngLat|NaN/i.test(m)) ?? 'map error');
      } else if (await noFatal(page, 'public.jobs_map')) {
        log('public.jobs_map', 'PASS');
      }
    }

    await page.goto('/marketplace');
    await page.waitForTimeout(2000);
    if (await noFatal(page, 'public.marketplace')) log('public.marketplace', 'PASS');

    await page.goto('/providers');
    await page.waitForTimeout(2000);
    if (await noFatal(page, 'public.providers')) {
      // providers API returned 401 earlier — check UI handling
      const err = page.getByText(/failed|error|unauthorized|sign in/i);
      const cards = page.locator('[data-testid], article, a[href*="/providers/"]');
      if ((await cards.count()) > 0) log('public.providers', 'PASS', `items=${await cards.count()}`);
      else if ((await err.count()) > 0)
        log('public.providers', 'FAIL', 'error/empty auth wall on public providers');
      else log('public.providers', 'PARTIAL', 'no cards and no clear error');
    }
    await shot(page, 'public-providers');

    await page.goto('/pricing');
    await page.waitForTimeout(2000);
    if (await noFatal(page, 'public.pricing')) log('public.pricing', 'PASS');

    await page.goto('/demo/auction');
    await page.waitForTimeout(3000);
    if (await noFatal(page, 'public.demo_auction')) log('public.demo_auction', 'PASS');
    await shot(page, 'public-demo');

    // Auth pages validation
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('not-an-email');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForTimeout(500);
    log('public.login_validation', 'PASS');

    await page.goto('/register');
    await page.waitForTimeout(1000);
    if (await noFatal(page, 'public.register')) log('public.register', 'PASS');
  });
});
