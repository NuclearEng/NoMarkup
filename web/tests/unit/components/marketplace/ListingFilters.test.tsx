import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../../app/dashboard/_helpers';

import type { Market, SearchListingsParams, ServiceCategory } from '@/types';

// Radix Popover (category picker + MarketSelector) leans on pointer-capture and
// scrollIntoView, neither of which jsdom implements.
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => undefined;
HTMLElement.prototype.releasePointerCapture = () => undefined;
HTMLElement.prototype.scrollIntoView = () => undefined;

// In-memory localStorage shim — jsdom's default lacks bound methods, and
// useSelectedMarket / useRecentMarkets read and write it on every pick.
const memoryStore = new Map<string, string>();
const memoryStorage: Storage = {
  get length(): number {
    return memoryStore.size;
  },
  clear: () => { memoryStore.clear(); },
  getItem: (key: string) => memoryStore.get(key) ?? null,
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  removeItem: (key: string) => { memoryStore.delete(key); },
  setItem: (key: string, value: string) => { memoryStore.set(key, value); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
});

// ListingFilters now renders a DB-driven GoodsCategorySelector (useGoodsCategoryTree,
// which wraps useCategoryTree → useQuery) and a MarketSelector (useMarkets → useQuery).
// Stub both hooks so the filter UI is deterministic and no network fires; the
// QueryClientProvider wrapper supplies the query context they require. The backing
// state is mutable so individual tests can drive the category tree / market catalog.
const hookState = vi.hoisted(() => ({
  goodsTree: [] as ServiceCategory[] | undefined,
  markets: [] as Market[],
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ data: hookState.goodsTree, isLoading: false, isError: false }),
  useGoodsCategoryTree: () => ({ data: hookState.goodsTree, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useMarkets', () => ({
  useMarkets: () => ({ data: hookState.markets, isLoading: false, isError: false }),
}));

import { ListingFilters } from '@/components/marketplace/ListingFilters';

// Every render needs a QueryClientProvider for the market/category hooks above.
function render(node: ReactElement) {
  return rtlRender(withQueryClient(node));
}

function makeCategory(
  id: string,
  name: string,
  children?: ServiceCategory[],
): ServiceCategory {
  return {
    id,
    parentId: null,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    level: 1,
    description: null,
    icon: null,
    sortOrder: 0,
    ...(children ? { children } : {}),
  };
}

const CHAIRS = makeCategory('cat-chairs', 'Chairs');
const FURNITURE = makeCategory('cat-furniture', 'Furniture', [CHAIRS]);
const ELECTRONICS = makeCategory('cat-electronics', 'Electronics');
const TREE: ServiceCategory[] = [FURNITURE, ELECTRONICS];

const AUSTIN: Market = {
  id: 'mkt-austin',
  slug: 'austin',
  name: 'austin',
  region: 'Texas',
  region_code: 'TX',
  country: 'US',
  is_active: true,
  lat: 30.2672,
  lng: -97.7431,
};

// Markets with no geocode yet — the "coords pending" path in ListingFilters.
const DALLAS: Market = {
  ...AUSTIN,
  id: 'mkt-dallas',
  slug: 'dallas',
  name: 'dallas',
  lat: null,
  lng: null,
};

function lastPayload(onChange: ReturnType<typeof vi.fn>): SearchListingsParams {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as SearchListingsParams;
}

beforeEach(() => {
  hookState.goodsTree = [];
  hookState.markets = [];
  window.localStorage.clear();
});

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

  describe('text inputs — clearing', () => {
    it('strips the query key when the search box is emptied', () => {
      const onChange = vi.fn();
      render(<ListingFilters filters={{ query: 'sofa' }} onChange={onChange} />);
      const input = screen.getByLabelText<HTMLInputElement>(/Search/i);
      expect(input.value).toBe('sofa');
      fireEvent.change(input, { target: { value: '' } });
      const last = lastPayload(onChange);
      expect(last.query).toBeUndefined();
      expect(last.page).toBe(1);
    });

    it('strips the pickup_zip key when the zip box is emptied', () => {
      const onChange = vi.fn();
      render(<ListingFilters filters={{ pickup_zip: '94110' }} onChange={onChange} />);
      const input = screen.getByLabelText<HTMLInputElement>(/Zip/i);
      expect(input.value).toBe('94110');
      fireEvent.change(input, { target: { value: '' } });
      expect(lastPayload(onChange).pickup_zip).toBeUndefined();
    });
  });

  describe('price inputs', () => {
    it('shows the incoming min/max cents as whole dollars', () => {
      render(
        <ListingFilters
          filters={{ min_price_cents: 2500, max_price_cents: 199900 }}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByLabelText<HTMLInputElement>(/Min \$/i).value).toBe('25');
      expect(screen.getByLabelText<HTMLInputElement>(/Max \$/i).value).toBe('1999');
    });

    it('renders empty price inputs when no price filter is set', () => {
      render(<ListingFilters filters={{}} onChange={vi.fn()} />);
      expect(screen.getByLabelText<HTMLInputElement>(/Min \$/i).value).toBe('');
      expect(screen.getByLabelText<HTMLInputElement>(/Max \$/i).value).toBe('');
    });

    it('strips min_price_cents when the entered amount is not positive', () => {
      const onChange = vi.fn();
      render(<ListingFilters filters={{ min_price_cents: 2500 }} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText(/Min \$/i), { target: { value: '0' } });
      expect(lastPayload(onChange).min_price_cents).toBeUndefined();
    });

    it('converts dollars to cents when max price changes', () => {
      const onChange = vi.fn();
      render(<ListingFilters filters={{}} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText(/Max \$/i), { target: { value: '150' } });
      const last = lastPayload(onChange);
      expect(last.max_price_cents).toBe(15000);
      expect(last.page).toBe(1);
    });

    it('strips max_price_cents when the max box is emptied', () => {
      const onChange = vi.fn();
      render(<ListingFilters filters={{ max_price_cents: 15000 }} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText(/Max \$/i), { target: { value: '' } });
      expect(lastPayload(onChange).max_price_cents).toBeUndefined();
    });
  });

  describe('ending soon', () => {
    it('strips ending_soon when the checkbox is unchecked', () => {
      const onChange = vi.fn();
      render(<ListingFilters filters={{ ending_soon: true }} onChange={onChange} />);
      const box = screen.getByLabelText(/Ending soon/i);
      expect(box).toBeChecked();
      fireEvent.click(box);
      expect(lastPayload(onChange).ending_soon).toBeUndefined();
    });

    it('counts ending_soon alone as an active filter', () => {
      render(<ListingFilters filters={{ ending_soon: true }} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Clear filters/i })).toBeDefined();
    });
  });

  describe('category picker', () => {
    it('labels the trigger with the selected top-level category name', () => {
      hookState.goodsTree = TREE;
      render(<ListingFilters filters={{ category_id: 'cat-furniture' }} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('Furniture');
    });

    it('resolves a nested category name by walking the tree', () => {
      hookState.goodsTree = TREE;
      render(<ListingFilters filters={{ category_id: 'cat-chairs' }} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('Chairs');
    });

    it('falls back to "All categories" when the id matches nothing in the tree', () => {
      hookState.goodsTree = TREE;
      render(<ListingFilters filters={{ category_id: 'cat-unknown' }} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('All categories');
    });

    it('falls back to "All categories" before the tree has loaded', () => {
      hookState.goodsTree = undefined;
      render(<ListingFilters filters={{ category_id: 'cat-furniture' }} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('All categories');
    });

    it('emits category_id and closes the popover when a category is picked', async () => {
      const user = userEvent.setup();
      hookState.goodsTree = TREE;
      const onChange = vi.fn();
      render(<ListingFilters filters={{ page_size: 24 }} onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Category' }));
      const option = await screen.findByRole('button', { name: 'Electronics' });
      await user.click(option);

      const last = lastPayload(onChange);
      expect(last.category_id).toBe('cat-electronics');
      expect(last.page).toBe(1);
      expect(last.page_size).toBe(24);
      await waitFor(() => {
        expect(screen.queryByLabelText('Search goods categories')).toBeNull();
      });
    });

    it('shows a Clear control only while a category is selected, and strips it on click', async () => {
      const user = userEvent.setup();
      hookState.goodsTree = TREE;
      const onChange = vi.fn();
      const { rerender } = render(
        <ListingFilters filters={{}} onChange={onChange} />,
      );
      expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();

      rerender(
        withQueryClient(
          <ListingFilters filters={{ category_id: 'cat-furniture' }} onChange={onChange} />,
        ),
      );
      await user.click(screen.getByRole('button', { name: 'Clear' }));
      const last = lastPayload(onChange);
      expect(last.category_id).toBeUndefined();
      expect(last.page).toBe(1);
    });
  });

  describe('city / market selection', () => {
    it('applies the market coordinates and a default radius when a geocoded city is picked', async () => {
      const user = userEvent.setup();
      hookState.markets = [AUSTIN];
      const onChange = vi.fn();
      render(<ListingFilters filters={{ page_size: 12 }} onChange={onChange} />);

      await user.click(screen.getByRole('combobox', { name: 'Select a city or market' }));
      await user.click(await screen.findByRole('option', { name: 'Austin' }));

      const last = lastPayload(onChange);
      expect(last.lat).toBeCloseTo(30.2672, 4);
      expect(last.lng).toBeCloseTo(-97.7431, 4);
      expect(last.radius_km).toBe(40);
      expect(last.page).toBe(1);
      expect(last.page_size).toBe(12);
      // The picker reflects the new city to the user.
      expect(
        screen.getByRole('combobox', { name: 'Select a city or market' }),
      ).toHaveTextContent('Austin, TX');
    });

    it('keeps an already-chosen radius instead of the 40km default', async () => {
      const user = userEvent.setup();
      hookState.markets = [AUSTIN];
      const onChange = vi.fn();
      render(<ListingFilters filters={{ radius_km: 16 }} onChange={onChange} />);

      await user.click(screen.getByRole('combobox', { name: 'Select a city or market' }));
      await user.click(await screen.findByRole('option', { name: 'Austin' }));

      expect(lastPayload(onChange).radius_km).toBe(16);
    });

    it('sets the city without changing filters when the market has no coordinates', async () => {
      const user = userEvent.setup();
      hookState.markets = [DALLAS];
      const onChange = vi.fn();
      render(<ListingFilters filters={{}} onChange={onChange} />);

      await user.click(screen.getByRole('combobox', { name: 'Select a city or market' }));
      await user.click(await screen.findByRole('option', { name: 'Dallas' }));

      expect(onChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole('combobox', { name: 'Select a city or market' }),
      ).toHaveTextContent('Dallas, TX');
    });

    it('clearing the city leaves the search filters untouched', async () => {
      const user = userEvent.setup();
      hookState.markets = [AUSTIN];
      window.localStorage.setItem('nm.selectedMarket', JSON.stringify(AUSTIN));
      const onChange = vi.fn();
      render(<ListingFilters filters={{ query: 'sofa' }} onChange={onChange} />);

      const trigger = screen.getByRole('combobox', { name: 'Select a city or market' });
      await waitFor(() => {
        expect(trigger).toHaveTextContent('Austin, TX');
      });
      await user.click(trigger);
      await user.click(await screen.findByRole('button', { name: 'Clear selection' }));

      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(
          screen.getByRole('combobox', { name: 'Select a city or market' }),
        ).toHaveTextContent('Choose a city');
      });
    });

    it('explains that a zip is needed for precise radius filtering', () => {
      render(<ListingFilters filters={{}} onChange={vi.fn()} />);
      expect(screen.getByText(/Enter a zip for precise radius/i)).toBeDefined();
    });
  });
});
