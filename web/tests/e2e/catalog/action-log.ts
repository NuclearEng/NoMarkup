import { expect, type Page } from '@playwright/test';

export type ActionHop = {
  kind: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  outcome: string;
};

export async function readActionLog(page: Page): Promise<ActionHop[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __NOMARKUP_ACTION_LOG__?: () => ActionHop[] };
    if (typeof w.__NOMARKUP_ACTION_LOG__ !== 'function') return [];
    return [...w.__NOMARKUP_ACTION_LOG__()];
  });
}

function statusMatches(actual: number, expected: number | number[] | undefined): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

export function catalogPathMatches(actual: string, pattern: string): boolean {
  const a = (actual.split('?')[0] ?? actual).replace(/\/$/, '') || '/';
  const p = pattern.replace(/\/$/, '') || '/';
  if (!p.includes('{')) {
    return a === p || a.includes(p);
  }
  const aSegs = a.split('/');
  const pSegs = p.split('/');
  if (aSegs.length === pSegs.length) {
    return pSegs.every((seg, i) => {
      const got = aSegs[i] ?? '';
      if (seg.startsWith('{') && seg.endsWith('}')) return got.length > 0;
      return seg === got;
    });
  }
  const re = new RegExp(
    p
      .split('/')
      .map((seg) => {
        if (seg.startsWith('{') && seg.endsWith('}')) return '[^/]+';
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/'),
  );
  return re.test(a);
}

export async function expectHttpHop(
  page: Page,
  spec: { method: string; path: string; status?: number | number[] },
  timeoutMs = 20_000,
): Promise<ActionHop> {
  let found: ActionHop | undefined;
  await expect
    .poll(
      async () => {
        const log = await readActionLog(page);
        found = log.find(
          (e) =>
            e.kind === 'http' &&
            e.method.toUpperCase() === spec.method.toUpperCase() &&
            catalogPathMatches(e.path, spec.path) &&
            statusMatches(e.status, spec.status),
        );
        return found !== undefined;
      },
      { timeout: timeoutMs, message: `HTTP ${spec.method} ${spec.path} ${JSON.stringify(spec.status)}` },
    )
    .toBe(true);
  if (!found) {
    throw new Error(`missing hop ${spec.method} ${spec.path}`);
  }
  return found;
}

export async function expectScreenHop(page: Page, route: string): Promise<void> {
  await expect
    .poll(async () => {
      const log = await readActionLog(page);
      return log.some((e) => e.kind === 'screen' && e.path.includes(route));
    }, { timeout: 15_000, message: `SCREEN ${route}` })
    .toBe(true);
}
