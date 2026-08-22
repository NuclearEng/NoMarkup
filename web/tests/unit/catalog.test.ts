import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type Catalog = {
  version: number;
  personas: string[];
  workflows: { id: string; method: string | null; path: string | null }[];
};

const catalog = JSON.parse(
  readFileSync(join(process.cwd(), '../docs/workflows/catalog.json'), 'utf8'),
) as Catalog;

describe('workflow catalog.json', () => {
  it('has more than 14 workflows including mutations', () => {
    expect(catalog.workflows.length).toBeGreaterThan(14);
    const ids = catalog.workflows.map((w) => w.id);
    expect(ids).toContain('account.profile.save');
    expect(ids).toContain('account.plan_limits.enforce');
    expect(ids).toContain('money.pay_order');
    expect(ids).toContain('bid.retract');
  });

  it('covers seed personas', () => {
    expect(catalog.personas).toEqual(['customer', 'provider', 'provider2', 'admin']);
  });

  it('uses real HTTP methods on every hop', () => {
    for (const wf of catalog.workflows) {
      if (wf.method === null && wf.path === null) continue;
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(wf.method);
      expect(wf.path).toMatch(/^\/api\/v1\//);
    }
  });
});
