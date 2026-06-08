import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../../app/dashboard/_helpers';

// ListingFilters now renders a DB-driven GoodsCategorySelector (useGoodsCategoryTree,
// which wraps useCategoryTree → useQuery) and a MarketSelector (useMarkets → useQuery).
// Stub both hooks so the filter UI is deterministic and no network fires; the
// QueryClientProvider wrapper supplies the query context they require.
vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ data: [], isLoading: false, isError: false }),
  useGoodsCategoryTree: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useMarkets', () => ({
  useMarkets: () => ({ data: [], isLoading: false, isError: false }),
}));

import { ListingFilters } from '@/components/marketplace/ListingFilters';
import type { SearchListingsParams } from '@/types';

// Every render needs a QueryClientProvider for the market/category hooks above.
function render(node: ReactElement) {
  return rtlRender(withQueryClient(node));
}

describe('ListingFilters', () => {
  it('renders the search, zip, radius, price inputs', () => {
    render(<ListingFilters filters={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Search/i)).toBeDefined();
    expect(screen.getByLabelText(/Zip/i)).toBeDefined();
    expect(screen.getByLabelText(/Radius/i)).toBeDefined();
    expect(screen.getByLabelText(/Min \$/i)).toBeDefined();
    expect(screen.getByLabelText(/Max \$/i)).toBeDefined();
    expect(screen.getByLabelText(/Ending soon/i)).toBeDefined();
  });

  it('emits onChange with query when search input changes', () => {
    const onChange = vi.fn();
    render(<ListingFilters filters={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Search/i), { target: { value: 'sofa' } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
    expect(last.query).toBe('sofa');
  });

  it('emits onChange with zip when zip input changes', () => {
    const onChange = vi.fn();
    render(<ListingFilters filters={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Zip/i), { target: { value: '94110' } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
    expect(last.pickup_zip).toBe('94110');
  });

  it('converts miles to km when radius input changes', () => {
    const onChange = vi.fn();
    render(<ListingFilters filters={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Radius/i), { target: { value: '10' } });
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
    // 10 miles ≈ 16km
    expect(last.radius_km).toBeGreaterThanOrEqual(15);
    expect(last.radius_km).toBeLessThanOrEqual(17);
  });

  it('clears radius when input is invalid (≤0)', () => {
    const onChange = vi.fn();
    render(<ListingFilters filters={{ radius_km: 16 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Radius/i), { target: { value: '0' } });
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
    expect(last.radius_km).toBeUndefined();
  });

  it('converts dollars to cents when min price changes', () => {
    const onChange = vi.fn();
    render(<ListingFilters filters={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Min \$/i), { target: { value: '20' } });
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
    expect(last.min_price_cents).toBe(2000);
  });

  it('toggles ending_soon when checkbox is checked', () => {
    const onChange = vi.fn();
    render(<ListingFilters filters={{}} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Ending soon/i));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
    expect(last.ending_soon).toBe(true);
  });

  it('renders Clear filters button when at least one filter is set', () => {
    render(<ListingFilters filters={{ query: 'sofa' }} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Clear filters/i })).toBeDefined();
  });

  it('does not render Clear filters button when no filters are set', () => {
    render(<ListingFilters filters={{}} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Clear filters/i })).toBeNull();
  });

  it('emits an empty filters payload when Clear filters is clicked', () => {
    const onChange = vi.fn();
    render(<ListingFilters filters={{ query: 'sofa', page_size: 12 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
    expect(last.query).toBeUndefined();
    expect(last.page).toBe(1);
  });
});
