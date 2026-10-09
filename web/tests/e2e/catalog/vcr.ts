/**
 * Frozen HTTP fixtures for catalog E2E. When HAS_STACK is false, Playwright
 * `page.route` fulfills catalog hops from these files so CI needs no gateway.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page, Route } from '@playwright/test';

export const VCR_PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000099';

export type VcrFixture = {
  method: string;
  path: string;
  status: number;
  contentType: string;
  body: unknown;
};

export type CatalogWorkflow = {
  id: string;
  method: string | null;
  path: string | null;
  status?: number | number[] | null;
  vcr?: string;
};

const FIXTURES_DIR = join(process.cwd(), 'tests/e2e/catalog/fixtures');

export function fixturesDir(): string {
  return FIXTURES_DIR;
}

export function pathTemplateMatches(actualPath: string, template: string): boolean {
  const actual = stripPath(actualPath);
  const pattern = stripPath(template);
  const aSegs = actual.split('/');
  const tSegs = pattern.split('/');
  if (aSegs.length !== tSegs.length) return false;
  return tSegs.every((seg, i) => {
    const got = aSegs[i] ?? '';
    if (seg.startsWith('{') && seg.endsWith('}')) return got.length > 0;
    return seg === got;
  });
}

export function instantiatePath(template: string, id = VCR_PLACEHOLDER_ID): string {
  return template.replace(/\{[^}]+\}/g, id);
}

export function stripPath(path: string): string {
  const noHash = path.split('#')[0] ?? path;
  const noQuery = noHash.split('?')[0] ?? noHash;
  if (noQuery.length > 1 && noQuery.endsWith('/')) return noQuery.slice(0, -1);
  return noQuery.length > 0 ? noQuery : '/';
}

export function statusList(status: number | number[] | null | undefined): number[] {
  if (status === null || status === undefined) return [];
  return Array.isArray(status) ? status : [status];
}

export function loadFixtureFile(filePath: string): VcrFixture {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as VcrFixture;
  if (typeof raw.method !== 'string' || typeof raw.path !== 'string') {
    throw new Error(`invalid fixture ${filePath}: method/path required`);
  }
  if (typeof raw.status !== 'number') {
    throw new Error(`invalid fixture ${filePath}: status required`);
  }
  return {
    method: raw.method.toUpperCase(),
    path: raw.path,
    status: raw.status,
    contentType: raw.contentType || 'application/json',
    body: raw.body ?? null,
  };
}

export function loadAllFixtures(): { file: string; fixture: VcrFixture }[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({
      file: name,
      fixture: loadFixtureFile(join(FIXTURES_DIR, name)),
    }));
}

export function fixturePathForWorkflow(wf: CatalogWorkflow): string {
  if (wf.vcr && wf.vcr.length > 0) {
    return join(process.cwd(), 'tests/e2e/catalog', wf.vcr);
  }
  return join(FIXTURES_DIR, `${wf.id}.json`);
}

export function loadFixtureForWorkflow(wf: CatalogWorkflow): VcrFixture {
  return loadFixtureFile(fixturePathForWorkflow(wf));
}

export function matchFixture(
  fixtures: VcrFixture[],
  method: string,
  path: string,
): VcrFixture | undefined {
  const m = method.toUpperCase();
  const pathname = stripPath(path);
  return fixtures.find(
    (f) => f.method === m && pathTemplateMatches(pathname, f.path),
  );
}

export function fulfillBody(fixture: VcrFixture): string {
  if (fixture.body === null || fixture.body === undefined) return '';
  if (typeof fixture.body === 'string') return fixture.body;
  return JSON.stringify(fixture.body);
}

export async function fulfillWithFixture(route: Route, fixture: VcrFixture): Promise<void> {
  await route.fulfill({
    status: fixture.status,
    contentType: fixture.contentType,
    body: fulfillBody(fixture),
    headers: {
      'X-Request-ID': 'vcr-fixture-request',
    },
  });
}

/** Intercept catalog API hops and fulfill from frozen fixtures. */
export async function installCatalogVcr(page: Page, fixtures: VcrFixture[]): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const fixture = matchFixture(fixtures, req.method(), url.pathname);
    if (!fixture) {
      await route.fulfill({
        status: 599,
        contentType: 'application/json',
        body: JSON.stringify({ error: `no VCR fixture for ${req.method()} ${url.pathname}` }),
      });
      return;
    }
    await fulfillWithFixture(route, fixture);
  });
}
