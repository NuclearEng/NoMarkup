// Admin markets page — the United States is listed before Mexico. The comment
// said "US first" but the sort was alphabetical by code, which put MX first.
// US first matches the public market list (gateway markets.go orders by
// `(country <> 'US'), country`).
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Market } from '@/types';

const markets = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useAdmin', () => ({
  useAdminMarkets: () => markets() as unknown,
  useSetMarketsActive: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import AdminMarketsPage from '@/app/(dashboard)/admin/markets/page';

function market(overrides: Partial<Market>): Market {
  return {
    id: 'm',
    slug: 'm',
    name: 'Market',
    region: 'California',
    region_code: 'CA',
    country: 'US',
    is_active: true,
    lat: null,
    lng: null,
    ...overrides,
  };
}

const CDMX = market({ id: 'mx-1', slug: 'cdmx', name: 'Ciudad de México', region: 'CDMX', region_code: 'CMX', country: 'MX' });
const SF = market({ id: 'us-1', slug: 'sfbay', name: 'SF bay area' });
const AUSTIN = market({ id: 'us-2', slug: 'austin', name: 'Austin', region: 'Texas', region_code: 'TX' });

function countryHeadings(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
}

function show(list: Market[]) {
  markets.mockReturnValue({ data: { markets: list }, isLoading: false, isError: false });
  render(createElement(AdminMarketsPage));
}

beforeEach(() => {
  markets.mockReset();
});

describe('AdminMarketsPage — country order', () => {
  it('lists the United States before Mexico', () => {
    show([SF, CDMX, AUSTIN]);
    expect(countryHeadings()).toEqual(['United States', 'Mexico']);
  });

  it('does so whatever order the API returns the markets in', () => {
    show([CDMX, AUSTIN, SF]);
    expect(countryHeadings()).toEqual(['United States', 'Mexico']);
  });

  it('shows a single country on its own', () => {
    show([CDMX]);
    expect(countryHeadings()).toEqual(['Mexico']);
  });
});
