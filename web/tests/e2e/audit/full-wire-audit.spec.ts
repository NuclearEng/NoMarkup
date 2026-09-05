/**
 * Full wire audit — every persona × every major route.
 * Probes page load, console errors, failed API calls, interactive controls,
 * and basic performance (navigation timing). Writes JSON report to
 * /tmp/nomarkup-web-audit/reports/wire-audit.json
 *
 * Run:
 *   SEED_PASSWORD=... npx playwright test tests/e2e/audit/full-wire-audit.spec.ts --project=chromium
 */
import { test, expect, type Page, type ConsoleMessage, type Response } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { HAS_STACK, NO_STACK_REASON } from '../helpers/stack';
import { loginAs, type Persona } from '../dogfood/fixtures';

test.skip(!HAS_STACK, NO_STACK_REASON);

const REPORT_DIR = '/tmp/nomarkup-web-audit/reports';
const SHOT_DIR = '/tmp/nomarkup-web-audit/screenshots';

type Finding = {
  persona: string;
  route: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'info';
  kind:
    | 'console_error'
    | 'failed_request'
    | 'fatal_ui'
    | 'empty_dead'
    | 'auth_redirect'
    | 'slow'
    | 'broken_control'
    | 'perf'
    | 'ok';
  message: string;
  detail?: string;
};

type RouteResult = {
  persona: string;
  route: string;
  finalUrl: string;
  status: 'pass' | 'fail' | 'partial' | 'skip';
  loadMs: number;
  title: string;
  h1: string;
  buttonCount: number;
  linkCount: number;
  consoleErrors: string[];
  failedApis: string[];
  findings: Finding[];
  screenshot?: string;
};

const PUBLIC_ROUTES = [
  '/',
  '/jobs',
  '/jobs/map',
  '/marketplace',
  '/marketplace/map',
  '/providers',
  '/pricing',
  '/legal',
  '/privacy',
  '/terms',
  '/support',
  '/community-guidelines',
  '/login',
  '/register',
  '/demo/auction',
];

const CUSTOMER_ROUTES = [
  '/dashboard',
  '/profile',
  '/jobs/new',
  '/jobs/new/legal',
  '/jobs/mine',
  '/jobs/recurring',
  '/jobs',
  '/contracts',
  '/messages',
  '/payments',
  '/notifications',
  '/marketplace',
  '/orders',
  '/sell/new',
  '/sell/mine',
  '/sell/analytics',
  '/me/positions',
  '/me/watchlist',
  '/me/wishlist',
  '/me/saved-searches',
  '/me/feed',
  '/me/referrals',
  '/properties',
  '/analytics',
  '/insurance',
  '/insurance/quotes',
  '/disputes/new',
  '/settings/account',
  '/settings/notifications',
  '/settings/payment-methods',
  '/settings/security',
  '/settings/subscription',
  '/bids', // may be provider-oriented but should not 500
];

const PROVIDER_ROUTES = [
  '/dashboard',
  '/provider',
  '/provider/workspace',
  '/provider/onboarding',
  '/provider/team',
  '/provider/verification',
  '/provider/advances',
  '/provider/business',
  '/provider/business/expenses',
  '/provider/business/invoices',
  '/provider/business/tax',
  '/provider/challenges',
  '/provider/offers',
  '/bids',
  '/jobs',
  '/contracts',
  '/messages',
  '/payments',
  '/notifications',
  '/settings/account',
  '/settings/security',
  '/settings/payment-methods',
  '/settings/subscription',
  '/marketplace',
  '/sell/new',
  '/sell/mine',
  '/me/feed',
];

const ADMIN_ROUTES = [
  '/admin',
  '/admin/users',
  '/admin/jobs',
  '/admin/listings',
  '/admin/payments',
  '/admin/disputes',
  '/admin/fraud',
  '/admin/flags',
  '/admin/markets',
  '/admin/reviews',
  '/admin/licenses',
  '/admin/verification',
  '/admin/insurance',
  '/admin/insurers',
  '/admin/banking',
  '/admin/challenges',
  '/admin/advances',
  '/admin/guarantee',
  '/admin/goods-reports',
  '/admin/user-reports',
  '/admin/taxonomy',
  '/admin/platform',
  '/dashboard',
  '/messages',
  '/settings/account',
];

const allResults: RouteResult[] = [];

function ensureDirs() {
  for (const d of [
    REPORT_DIR,
    path.join(SHOT_DIR, 'public'),
    path.join(SHOT_DIR, 'customer'),
    path.join(SHOT_DIR, 'provider'),
    path.join(SHOT_DIR, 'admin'),
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function isNoiseConsole(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('download the react devtools') ||
    t.includes('fast refresh') ||
    t.includes('[hmr]') ||
    t.includes('webpack') ||
    t.includes('turbopack') ||
    // Next.js dev overlay noise
    t.includes('hot-reloader') ||
    t.includes('failed to load resource: the server responded with a status of 401') ||
    // Stripe/analytics expected in some envs
    t.includes('third-party cookie')
  );
}

function isRelevantApi(url: string): boolean {
  return url.includes('/api/') || url.includes('localhost:8081') || url.includes('127.0.0.1:8081');
}

type Collectors = {
  consoleErrors: string[];
  failedApis: string[];
  dispose: () => void;
};

function attachCollectors(page: Page): Collectors {
  const consoleErrors: string[] = [];
  const failedApis: string[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isNoiseConsole(text)) consoleErrors.push(text.slice(0, 500));
    }
  };
  const onPageError = (err: Error) => {
    consoleErrors.push(`pageerror: ${err.message}`.slice(0, 500));
  };
  const onResponse = (res: Response) => {
    const url = res.url();
    if (!isRelevantApi(url)) return;
    const status = res.status();
    // Flag 5xx API failures only (401/403 are authz, not wire breaks)
    if (status >= 500) {
      failedApis.push(`${status} ${url.slice(0, 200)}`);
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  return {
    consoleErrors,
    failedApis,
    dispose: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
    },
  };
}

async function probePage(
  page: Page,
  persona: string,
  route: string,
  opts: { clickSafeButtons?: boolean } = {},
): Promise<RouteResult> {
  const findings: Finding[] = [];
  const collectors = attachCollectors(page);
  const t0 = Date.now();

  try {
  // Retry transient navigation aborts (Next soft nav / HMR / concurrent redirects)
  let lastNavErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      lastNavErr = undefined;
      break;
    } catch (err) {
      lastNavErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/ERR_ABORTED|Navigation interrupted|net::ERR/i.test(msg) || attempt === 2) {
        throw err;
      }
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
  if (lastNavErr) throw lastNavErr;
  // Allow client data fetch + AuthRestorer
  await page.waitForTimeout(1_800);
  const loadMs = Date.now() - t0;

  const finalUrl = page.url();
  let title = '';
  try {
    title = await page.title();
  } catch {
    title = '';
  }

  let h1 = '';
  try {
    h1 = ((await page.locator('h1').first().textContent({ timeout: 3_000 })) ?? '').trim();
  } catch {
    h1 = '';
  }

  const buttonCount = await page.getByRole('button').count();
  const linkCount = await page.getByRole('link').count();

  // Fatal UI
  const fatal = page.locator(
    'text=/^500$/i, text=/Internal Server Error/i, text=/Application error/i, text=/This page could not be found/i',
  );
  if ((await fatal.count()) > 0) {
    findings.push({
      persona,
      route,
      severity: 'P0',
      kind: 'fatal_ui',
      message: 'Fatal error / 404 chrome visible',
      detail: ((await fatal.first().textContent()) ?? '').slice(0, 200),
    });
  }

  // Unexpected login redirect for authed personas
  if (persona !== 'public' && finalUrl.includes('/login') && !route.includes('login')) {
    findings.push({
      persona,
      route,
      severity: 'P0',
      kind: 'auth_redirect',
      message: `Authed persona redirected to login: ${finalUrl}`,
    });
  }

  // Slow page (soft budget)
  if (loadMs > 5000) {
    findings.push({
      persona,
      route,
      severity: 'P2',
      kind: 'slow',
      message: `Slow load ${loadMs}ms (>5s soft budget)`,
    });
  } else if (loadMs > 2500) {
    findings.push({
      persona,
      route,
      severity: 'P3',
      kind: 'perf',
      message: `Load ${loadMs}ms (target LCP-like <2.5s felt)`,
    });
  }

  // Console / API failures
  for (const e of collectors.consoleErrors) {
    findings.push({
      persona,
      route,
      severity: 'P1',
      kind: 'console_error',
      message: e,
    });
  }
  for (const e of collectors.failedApis) {
    findings.push({
      persona,
      route,
      severity: 'P0',
      kind: 'failed_request',
      message: e,
    });
  }

  // Safe button probe: click non-destructive visible buttons that look like navigation/tabs/filters
  if (opts.clickSafeButtons) {
    const safeName =
      /next|continue|filter|search|refresh|retry|apply|show|hide|expand|collapse|view|tab|sort|clear|reset|cancel|back|close|dismiss|got it|ok|learn more|see all|load more|try again/i;
    const destructive =
      /delete|remove|suspend|ban|refund|payout|release|charge|pay now|submit|publish|place bid|accept|reject|confirm|sign out|log out|disable|revoke|terminate|cancel subscription/i;

    const buttons = page.getByRole('button');
    const n = Math.min(await buttons.count(), 12);
    for (let i = 0; i < n; i++) {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      const name = ((await btn.textContent()) ?? '').trim();
      if (!name || name.length > 60) continue;
      if (destructive.test(name)) continue;
      if (!safeName.test(name) && !/filter|sort|tab/i.test(name)) continue;

      const urlBefore = page.url();
      try {
        await btn.click({ timeout: 3_000, trial: false });
        await page.waitForTimeout(600);
        // If a dialog opened, close it
        const dialog = page.getByRole('dialog');
        if ((await dialog.count()) > 0 && (await dialog.first().isVisible())) {
          const close = dialog
            .first()
            .getByRole('button', { name: /close|cancel|dismiss|got it|ok/i });
          if ((await close.count()) > 0) {
            await close.first().click().catch(() => undefined);
          } else {
            await page.keyboard.press('Escape');
          }
        }
        // If we navigated away from intended area unexpectedly to an error page
        if ((await fatal.count()) > 0) {
          findings.push({
            persona,
            route,
            severity: 'P0',
            kind: 'broken_control',
            message: `Button "${name}" led to fatal UI`,
          });
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1000);
        } else if (page.url() !== urlBefore && page.url().includes('/login') && persona !== 'public') {
          findings.push({
            persona,
            route,
            severity: 'P1',
            kind: 'broken_control',
            message: `Button "${name}" kicked to login`,
          });
          break;
        }
      } catch (err) {
        findings.push({
          persona,
          route,
          severity: 'P2',
          kind: 'broken_control',
          message: `Button "${name}" click failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Screenshot
  const safeName = route.replace(/\//g, '_').replace(/^_/, '') || 'home';
  const shotPath = path.join(SHOT_DIR, persona, `${safeName}.png`);
  try {
    await page.screenshot({ path: shotPath, fullPage: false });
  } catch {
    // ignore
  }

  const hasP0 = findings.some((f) => f.severity === 'P0');
  const hasP1 = findings.some((f) => f.severity === 'P1');
  const status: RouteResult['status'] = hasP0 ? 'fail' : hasP1 ? 'partial' : 'pass';

  if (findings.length === 0) {
    findings.push({
      persona,
      route,
      severity: 'info',
      kind: 'ok',
      message: `OK load ${loadMs}ms · ${buttonCount} buttons · ${linkCount} links · h1="${h1.slice(0, 80)}"`,
    });
  }

  return {
    persona,
    route,
    finalUrl,
    status,
    loadMs,
    title,
    h1,
    buttonCount,
    linkCount,
    consoleErrors: [...collectors.consoleErrors],
    failedApis: [...collectors.failedApis],
    findings,
    screenshot: shotPath,
  };
  } finally {
    collectors.dispose();
  }
}

async function runRouteList(page: Page, persona: Persona | 'public', routes: string[]) {
  for (const route of routes) {
    // Session recovery if prior route kicked us to login
    if (persona !== 'public' && page.url().includes('/login')) {
      await loginAs(page, persona);
    }
    const result = await probePage(page, persona, route, { clickSafeButtons: true });
    // If auth bounce mid-route, re-login once and re-probe
    if (
      persona !== 'public' &&
      result.findings.some((f) => f.kind === 'auth_redirect')
    ) {
      await loginAs(page, persona);
      const retry = await probePage(page, persona, route, { clickSafeButtons: true });
      allResults.push(retry);
      expect.soft(retry.status !== 'fail', `${persona} ${route} should not hard-fail`).toBeTruthy();
      continue;
    }
    allResults.push(result);
    expect.soft(result.status !== 'fail', `${persona} ${route} should not hard-fail`).toBeTruthy();
  }
}

test.describe.configure({ mode: 'serial' });

function writeReport() {
  ensureDirs();
  // Merge with any prior partial report so parallel persona runs accumulate
  const outJson = path.join(REPORT_DIR, 'wire-audit.json');
  let prior: RouteResult[] = [];
  try {
    if (fs.existsSync(outJson)) {
      const prev = JSON.parse(fs.readFileSync(outJson, 'utf8')) as { results?: RouteResult[] };
      prior = prev.results ?? [];
    }
  } catch {
    prior = [];
  }
  const byKey = new Map<string, RouteResult>();
  for (const r of prior) byKey.set(`${r.persona}::${r.route}`, r);
  for (const r of allResults) byKey.set(`${r.persona}::${r.route}`, r);
  const merged = [...byKey.values()];

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      routes: merged.length,
      pass: merged.filter((r) => r.status === 'pass').length,
      partial: merged.filter((r) => r.status === 'partial').length,
      fail: merged.filter((r) => r.status === 'fail').length,
    },
    p0: merged.flatMap((r) => r.findings).filter((f) => f.severity === 'P0'),
    p1: merged.flatMap((r) => r.findings).filter((f) => f.severity === 'P1'),
    p2: merged.flatMap((r) => r.findings).filter((f) => f.severity === 'P2'),
    results: merged,
  };
  fs.writeFileSync(outJson, JSON.stringify(summary, null, 2));

  const lines: string[] = [
    '# Full wire audit',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    `Routes: ${summary.totals.routes} · Pass: ${summary.totals.pass} · Partial: ${summary.totals.partial} · Fail: ${summary.totals.fail}`,
    '',
    '## P0 findings',
    '',
  ];
  if (summary.p0.length === 0) lines.push('_None_');
  else {
    for (const f of summary.p0) {
      lines.push(`- **[${f.persona}] ${f.route}** (${f.kind}): ${f.message}`);
    }
  }
  lines.push('', '## P1 findings', '');
  if (summary.p1.length === 0) lines.push('_None_');
  else {
    for (const f of summary.p1.slice(0, 80)) {
      lines.push(`- **[${f.persona}] ${f.route}** (${f.kind}): ${f.message.slice(0, 200)}`);
    }
  }
  lines.push(
    '',
    '## Route matrix',
    '',
    '| Persona | Route | Status | ms | Buttons | H1 |',
    '|---|---|---|---:|---:|---|',
  );
  for (const r of merged) {
    lines.push(
      `| ${r.persona} | \`${r.route}\` | ${r.status} | ${r.loadMs} | ${r.buttonCount} | ${r.h1.replace(/\|/g, '/').slice(0, 40)} |`,
    );
  }
  fs.writeFileSync(path.join(REPORT_DIR, 'wire-audit.md'), lines.join('\n'));
}

// Independent describes so one persona failure does not skip the others
test.describe('Wire audit — public', () => {
  test.describe.configure({ mode: 'serial', timeout: 15 * 60_000 });
  test.afterAll(() => writeReport());
  test('public routes', async ({ page }) => {
    ensureDirs();
    await runRouteList(page, 'public', PUBLIC_ROUTES);
  });
});

test.describe('Wire audit — customer', () => {
  test.describe.configure({ mode: 'serial', timeout: 20 * 60_000 });
  test.afterAll(() => writeReport());
  test('customer routes', async ({ page }) => {
    ensureDirs();
    await loginAs(page, 'customer');
    await runRouteList(page, 'customer', CUSTOMER_ROUTES);
  });
});

test.describe('Wire audit — provider', () => {
  test.describe.configure({ mode: 'serial', timeout: 20 * 60_000 });
  test.afterAll(() => writeReport());
  test('provider routes', async ({ page }) => {
    ensureDirs();
    await loginAs(page, 'provider');
    await runRouteList(page, 'provider', PROVIDER_ROUTES);
  });
});

test.describe('Wire audit — admin', () => {
  test.describe.configure({ mode: 'serial', timeout: 20 * 60_000 });
  test.afterAll(() => writeReport());
  test('admin routes', async ({ page }) => {
    ensureDirs();
    await loginAs(page, 'admin');
    await runRouteList(page, 'admin', ADMIN_ROUTES);
  });
});
