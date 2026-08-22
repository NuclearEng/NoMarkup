/**
 * Catalog-driven E2E across every seed persona.
 *
 *   SEED_PASSWORD=Password123! npx playwright test tests/e2e/catalog --project=chromium
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HAS_STACK, NO_STACK_REASON } from '../helpers/stack';
import { loginAs, navigateTo, type Persona } from '../dogfood/fixtures';
import { expectHttpHop, expectScreenHop, readActionLog } from './action-log';

test.skip(!HAS_STACK, NO_STACK_REASON);

const ROOT = join(process.cwd(), '..');

type Workflow = {
  id: string;
  label: string;
  web: string;
  ios?: string;
  method: string | null;
  path: string | null;
  status?: number | number[];
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

test.describe.configure({ mode: 'serial' });
test.setTimeout(12 * 60_000);

function isGetLike(wf: Workflow): boolean {
  return wf.method === 'GET' && typeof wf.path === 'string' && wf.path.length > 0;
}

function expectedStatus(wf: Workflow, persona: Persona): number | number[] | undefined {
  const denied = wf.deny?.[persona];
  if (denied !== undefined) return denied;
  return wf.status;
}

function staticRoutesFor(persona: Persona): string[] {
  const all = pages.routes
    .map((r) => r.route)
    .filter((r) => !r.includes('['))
    .filter((r) => r !== '/login' && r !== '/register' && r !== '/forgot-password' && r !== '/reset-password' && r !== '/verify-email');
  if (persona === 'admin') {
    return all;
  }
  return all.filter((r) => !r.startsWith('/admin'));
}

for (const persona of PERSONAS) {
  test.describe(`catalog persona ${persona}`, () => {
    test(`login + GET catalog + static pages`, async ({ page }) => {
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
          // Deny entries may never fire the admin API (client guard). That is OK
          // when we expected 403 and no matching hop exists.
          if (wf.deny?.[persona] !== undefined) {
            const log = await readActionLog(page);
            const hop = log.find(
              (e) => e.kind === 'http' && e.path.includes(wf.path ?? ''),
            );
            if (!hop) {
              continue;
            }
          }
          failures.push(`${wf.id}: ${err instanceof Error ? err.message : String(err)}`);
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
