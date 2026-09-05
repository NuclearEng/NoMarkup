/**
 * Catalog-driven E2E across every seed persona.
 *
 * Backendless (CI): VCR fixture completeness + mocked route fulfill.
 * Live stack (SEED_PASSWORD): login + GET/mutation hops + static SCREEN hops.
 *
 *   SEED_PASSWORD=Password123! npx playwright test tests/e2e/catalog --project=chromium
 */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';

import { HAS_STACK, NO_STACK_REASON } from '../helpers/stack';
import { loginAs, navigateTo, type Persona } from '../dogfood/fixtures';
import { expectHttpHop, expectScreenHop, readActionLog } from './action-log';
import {
  fixturePathForWorkflow,
  instantiatePath,
  installCatalogVcr,
  loadAllFixtures,
  loadFixtureForWorkflow,
  statusList,
  type CatalogWorkflow,
} from './vcr';

const ROOT = join(process.cwd(), '..');
const FAKE_ID = '00000000-0000-4000-8000-000000000099';

type Workflow = CatalogWorkflow & {
  id: string;
  label: string;
  web: string;
  ios?: string;
  mutation?: boolean;
  persona?: string;
  deny?: Partial<Record<Persona, number>>;
};

const catalog = JSON.parse(
  readFileSync(join(ROOT, 'docs/workflows/catalog.json'), 'utf8'),
) as { personas: Persona[]; workflows: Workflow[] };

const pages = JSON.parse(
  readFileSync(join(ROOT, 'docs/workflows/pages.json'), 'utf8'),
) as { routes: { route: string }[] };

const PERSONAS: Persona[] = catalog.personas.filter(
  (p): p is Persona => p === 'customer' || p === 'provider' || p === 'provider2' || p === 'admin',
);

function isHttpWorkflow(wf: Workflow): boolean {
  return typeof wf.method === 'string' && typeof wf.path === 'string' && wf.path.length > 0;
}

function isGetLike(wf: Workflow): boolean {
  return wf.method === 'GET' && typeof wf.path === 'string' && wf.path.length > 0 && wf.mutation !== true;
}

function isMutation(wf: Workflow): boolean {
  if (!isHttpWorkflow(wf)) return false;
  if (wf.id === 'auth.login' || wf.id === 'account.sign_out') return false;
  return wf.mutation === true || wf.method !== 'GET';
}

function expectedStatus(wf: Workflow, persona: Persona): number | number[] | undefined {
  const denied = wf.deny?.[persona];
  if (denied !== undefined) return denied;
  return wf.status ?? undefined;
}

function staticRoutesFor(persona: Persona): string[] {
  const all = pages.routes
    .map((r) => r.route)
    .filter((r) => !r.includes('['))
    .filter(
      (r) =>
        r !== '/login' &&
        r !== '/register' &&
        r !== '/forgot-password' &&
        r !== '/reset-password' &&
        r !== '/verify-email',
    );
  if (persona === 'admin') return all;
  return all.filter((r) => !r.startsWith('/admin'));
}

function mutationBody(wf: Workflow, persona: Persona): Record<string, unknown> | undefined {
  if (wf.method === 'GET' || wf.method === 'HEAD' || wf.method === 'DELETE') return undefined;
  if (wf.id === 'account.profile.save') return { display_name: 'Customer' };
  if (wf.id === 'account.notification_prefs.save') {
    return { global_push_enabled: true, global_email_enabled: true };
  }
  if (wf.id === 'account.verification') return { email: `${persona}@nomarkup.com` };
  return {};
}

function needsIdempotency(path: string): boolean {
  return (
    path.includes('/pay') ||
    path.includes('/bids') ||
    path.includes('/process') ||
    path.includes('/listings') ||
    path.includes('/jobs')
  );
}

function statusAllowed(actual: number, expected: number | number[] | undefined): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

type CatalogFetchHop = {
  method: string;
  path: string;
  status: number;
  requestId: string;
};

/** Refresh via the httpOnly cookie so mutation hops can send Bearer (in-memory token is not on window). */
async function refreshAccessToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!r.ok) return '';
    const data = (await r.json()) as { access_token?: unknown };
    return typeof data.access_token === 'string' ? data.access_token : '';
  });
}

async function fireCatalogFetch(
  page: import('@playwright/test').Page,
  wf: Workflow,
  accessToken: string,
  persona: Persona,
): Promise<CatalogFetchHop> {
  const path = instantiatePath(wf.path ?? '', FAKE_ID);
  const method = wf.method ?? 'GET';
  const body = mutationBody(wf, persona);
  const hasBody = body !== undefined;
  return page.evaluate(
    async ({ method, path, body, hasBody, idempotent, accessToken }) => {
      const headers: Record<string, string> = {};
      if (hasBody) headers['Content-Type'] = 'application/json';
      if (idempotent) headers['Idempotency-Key'] = crypto.randomUUID();
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
      const r = await fetch(path, {
        method,
        headers,
        credentials: 'include',
        body: hasBody ? JSON.stringify(body) : undefined,
      });
      const requestId =
        r.headers.get('X-Request-ID') ?? r.headers.get('x-request-id') ?? '';
      return { method, path, status: r.status, requestId };
    },
    {
      method,
      path,
      body: body ?? {},
      hasBody,
      idempotent: method !== 'GET' && needsIdempotency(path),
      accessToken,
    },
  );
}

// ── Backendless (always runs in CI) ────────────────────────────────────────

test.describe('catalog VCR (backendless)', () => {
  test('every HTTP workflow has a frozen fixture matching method/path/status', () => {
    const http = catalog.workflows.filter(isHttpWorkflow);
    expect(http.length).toBeGreaterThan(14);
    const missing: string[] = [];
    for (const wf of http) {
      const file = fixturePathForWorkflow(wf);
      if (!existsSync(file)) {
        missing.push(`${wf.id}: missing ${wf.vcr ?? `fixtures/${wf.id}.json`}`);
        continue;
      }
      const fixture = loadFixtureForWorkflow(wf);
      if (fixture.method !== (wf.method ?? '').toUpperCase()) {
        missing.push(`${wf.id}: fixture method ${fixture.method} != ${wf.method}`);
      }
      if (fixture.path !== wf.path) {
        missing.push(`${wf.id}: fixture path ${fixture.path} != ${wf.path}`);
      }
      const allowed = statusList(wf.status);
      if (!allowed.includes(fixture.status)) {
        missing.push(`${wf.id}: fixture status ${fixture.status} not in ${JSON.stringify(allowed)}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  test('VCR fulfills each catalog hop from its fixture', async ({ page }) => {
    const fixtures = loadAllFixtures().map((f) => f.fixture);
    expect(fixtures.length).toBeGreaterThan(14);
    await installCatalogVcr(page, fixtures);
    await page.goto('/login');

    const failures: string[] = [];
    for (const wf of catalog.workflows.filter(isHttpWorkflow)) {
      const fixture = loadFixtureForWorkflow(wf);
      const path = instantiatePath(wf.path ?? '', FAKE_ID);
      const method = wf.method ?? 'GET';
      const result = await page.evaluate(
        async ({ method, path, hasBody }) => {
          const headers: Record<string, string> = {};
          if (hasBody) headers['Content-Type'] = 'application/json';
          const r = await fetch(path, {
            method,
            headers,
            body: hasBody ? '{}' : undefined,
          });
          return { status: r.status, contentType: r.headers.get('content-type') ?? '' };
        },
        { method, path, hasBody: method !== 'GET' && method !== 'HEAD' },
      );
      // Shared method+path (bid.place vs plan_limits.enforce) may resolve the
      // first matching fixture; accept any catalog status for that pair.
      const allowed = new Set(statusList(wf.status));
      const samePath = catalog.workflows.filter(
        (other) => other.method === wf.method && other.path === wf.path,
      );
      for (const other of samePath) {
        for (const s of statusList(other.status)) allowed.add(s);
      }
      if (!allowed.has(result.status)) {
        failures.push(
          `${wf.id}: ${method} ${path} → ${result.status} (fixture ${fixture.status}, allowed ${[...allowed].join(',')})`,
        );
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

// ── Live stack ─────────────────────────────────────────────────────────────

test.describe('catalog live stack', () => {
  test.skip(!HAS_STACK, NO_STACK_REASON);
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(12 * 60_000);

  for (const persona of PERSONAS) {
    test.describe(`catalog persona ${persona}`, () => {
      test(`login + GET catalog + mutations + static pages`, async ({ page }) => {
        await loginAs(page, persona);
        const loginHop = await expectHttpHop(page, {
          method: 'POST',
          path: '/api/v1/auth/login',
          status: 200,
        });
        expect(loginHop.requestId.length, `${persona} login request id`).toBeGreaterThan(7);

        const failures: string[] = [];

        for (const wf of catalog.workflows.filter(isGetLike)) {
          await navigateTo(page, wf.web, persona);
          const status = expectedStatus(wf, persona);
          try {
            await expectScreenHop(page, wf.web);
            await expectHttpHop(page, {
              method: wf.method ?? 'GET',
              path: wf.path ?? '',
              status,
            });
          } catch (err) {
            if (wf.deny?.[persona] !== undefined) {
              const log = await readActionLog(page);
              const hop = log.find((e) => e.kind === 'http' && e.path.includes(wf.path ?? ''));
              if (!hop) continue;
            }
            failures.push(`${wf.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Synthetic mutation hops use fetch() (not api.ts), so they never land
        // in __NOMARKUP_ACTION_LOG__. Assert the live response status directly.
        const accessToken = await refreshAccessToken(page);
        if (!accessToken) {
          failures.push(`${persona}: refresh returned no access token`);
        }

        for (const wf of catalog.workflows.filter(isMutation)) {
          const status = expectedStatus(wf, persona);
          try {
            const hop = await fireCatalogFetch(page, wf, accessToken, persona);
            if (!statusAllowed(hop.status, status)) {
              failures.push(
                `${wf.id}: HTTP ${hop.method} ${hop.path} → ${String(hop.status)} (expected ${JSON.stringify(status)}) request_id=${hop.requestId}`,
              );
            }
          } catch (err) {
            failures.push(`${wf.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const signOut = catalog.workflows.find((w) => w.id === 'account.sign_out');
        if (signOut && isHttpWorkflow(signOut)) {
          try {
            const hop = await fireCatalogFetch(page, signOut, accessToken, persona);
            const status = expectedStatus(signOut, persona);
            if (!statusAllowed(hop.status, status)) {
              failures.push(
                `account.sign_out: HTTP ${hop.method} ${hop.path} → ${String(hop.status)} (expected ${JSON.stringify(status)}) request_id=${hop.requestId}`,
              );
            }
          } catch (err) {
            failures.push(
              `account.sign_out: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        if (process.env['CATALOG_SKIP_PAGES'] === '1') {
          expect(failures, `${persona}\n${failures.join('\n')}`).toEqual([]);
          return;
        }

        for (const route of staticRoutesFor(persona)) {
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(350);
          const fatal = page.locator(
            'text=/Internal Server Error/i, text=/Application error/i, text=/^500$/i',
          );
          if ((await fatal.count()) > 0) {
            failures.push(`${route} fatal UI`);
            continue;
          }
          const log = await readActionLog(page);
          if (!log.some((e) => e.kind === 'screen')) {
            failures.push(`${route} missing SCREEN hop`);
          }
        }

        expect(failures, `${persona}\n${failures.join('\n')}`).toEqual([]);
      });
    });
  }
});
