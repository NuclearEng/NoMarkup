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
            e.path.includes(spec.path) &&
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
