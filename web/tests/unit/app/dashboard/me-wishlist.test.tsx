// /me/wishlist — dream-item list, add form (validation + cents conversion)
// and remove. Hooks are mocked so each state can be driven directly.
import { fireEvent, render, screen } from '@testing-library/react';
import { act, createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface WishlistRow {
  id: string;
  user_id: string;
  keyword: string;
  category_id: string | null;
  category_name: string | null;
  max_price_cents: number;
  created_at: string;
}

interface CreateOptions {
  onSuccess: () => void;
}

const wishlistState: {
  data: { wishlist_items: WishlistRow[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

const createMutate = vi.fn<(input: Record<string, unknown>, options: CreateOptions) => void>();
const createState = { mutate: createMutate, isPending: false };

const deleteMutate = vi.fn<(id: string) => void>();
const deleteState = { mutate: deleteMutate, isPending: false };

const categoriesState: { data: { id: string; name: string }[] | undefined } = { data: undefined };

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useWishlist', () => ({
  useWishlist: () => wishlistState,
  useCreateWishlistItem: () => createState,
  useDeleteWishlistItem: () => deleteState,
}));

vi.mock('@/hooks/useCategories', () => ({
  useGoodsCategoryTree: () => categoriesState,
}));

import WishlistPage from '@/app/(dashboard)/me/wishlist/page';

function renderPage() {
  return render(withQueryClient(createElement(WishlistPage)));
}

const keywordInput = () => screen.getByLabelText('What are you looking for?');
const priceInput = () => screen.getByLabelText('Notify me at or below ($)');
const categorySelect = () => screen.getByLabelText('Category (optional)');

function fill(values: { keyword?: string; price?: string; category?: string }) {
  if (values.keyword !== undefined) {
    fireEvent.change(keywordInput(), { target: { value: values.keyword } });
  }
  if (values.price !== undefined) {
    fireEvent.change(priceInput(), { target: { value: values.price } });
  }
  if (values.category !== undefined) {
    fireEvent.change(categorySelect(), { target: { value: values.category } });
  }
}

function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'Add a dream item' }));
}

function row(overrides: Partial<WishlistRow> = {}): WishlistRow {
  return {
    id: 'w-1',
    user_id: 'u-1',
    keyword: '4 wheeler',
    category_id: null,
    category_name: null,
    max_price_cents: 50000,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  wishlistState.data = undefined;
  wishlistState.isLoading = false;
  wishlistState.isError = false;
  wishlistState.refetch = vi.fn();
  createState.isPending = false;
  deleteState.isPending = false;
  categoriesState.data = undefined;
});

describe('WishlistPage — list states', () => {
  it('announces loading with three skeleton rows', () => {
    wishlistState.isLoading = true;
    renderPage();

    const status = screen.getByRole('status', { name: 'Loading wishlist' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.querySelectorAll('li')).toHaveLength(3);
    expect(screen.queryByText('No wishlist items yet')).toBeNull();
  });

  it('shows the error state and Retry calls refetch', () => {
    const refetch = vi.fn();
    wishlistState.isError = true;
    wishlistState.refetch = refetch;
    renderPage();

    expect(screen.getByText('Failed to load your wishlist')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when data is undefined', () => {
    renderPage();
    expect(screen.getByText('No wishlist items yet')).toBeInTheDocument();
  });

  it('shows the empty state for an empty list', () => {
    wishlistState.data = { wishlist_items: [] };
    renderPage();
    expect(screen.getByText('No wishlist items yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('renders items with their price ceiling and only shows a category when present', () => {
    wishlistState.data = {
      wishlist_items: [
        row({ category_id: 'c-1', category_name: 'Powersports' }),
        row({ id: 'w-2', keyword: 'kayak', max_price_cents: 12345 }),
      ],
    };
    renderPage();

    expect(screen.getByText('4 wheeler')).toBeInTheDocument();
    expect(screen.getByText('Alert at or below $500.00')).toBeInTheDocument();
    expect(screen.getByText('Powersports')).toBeInTheDocument();

    const kayakRow = screen.getByText('kayak').closest('li');
    expect(kayakRow).toHaveTextContent('Alert at or below $123.45');
    expect(kayakRow).not.toHaveTextContent('Powersports');
    expect(screen.queryByText('No wishlist items yet')).toBeNull();
  });

  it('removes the clicked item by id', () => {
    wishlistState.data = { wishlist_items: [row(), row({ id: 'w-2', keyword: 'kayak' })] };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove kayak from wishlist' }));
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate).toHaveBeenCalledWith('w-2');
  });

  it('disables remove buttons while a delete is pending', () => {
    wishlistState.data = { wishlist_items: [row()] };
    deleteState.isPending = true;
    renderPage();

    expect(screen.getByRole('button', { name: 'Remove 4 wheeler from wishlist' })).toBeDisabled();
  });
});

describe('WishlistPage — add form', () => {
  it('offers only "Any category" when the category tree has not loaded', () => {
    renderPage();
    const options = Array.from(categorySelect().querySelectorAll('option'));
    expect(options.map((o) => o.textContent)).toEqual(['Any category']);
  });

  it('lists the goods categories as options', () => {
    categoriesState.data = [
      { id: 'c-1', name: 'Powersports' },
      { id: 'c-2', name: 'Boats' },
    ];
    renderPage();
    const options = Array.from(categorySelect().querySelectorAll('option'));
    expect(options.map((o) => o.value)).toEqual(['', 'c-1', 'c-2']);
  });

  it('rejects a blank keyword and wires the error to both inputs', () => {
    renderPage();
    expect(keywordInput()).not.toHaveAttribute('aria-describedby');

    fill({ keyword: '   ', price: '500' });
    submit();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter what you’re looking for');
    expect(alert).toHaveAttribute('id', 'wishlist-form-error');
    expect(keywordInput()).toHaveAttribute('aria-describedby', 'wishlist-form-error');
    expect(priceInput()).toHaveAttribute('aria-describedby', 'wishlist-form-error');
    expect(createMutate).not.toHaveBeenCalled();
  });

  it.each(['', '0', '-20'])('rejects the max price %j', (price) => {
    renderPage();
    fill({ keyword: 'kayak', price });
    submit();

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a max price greater than $0.');
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('creates an item with a trimmed keyword and price in integer cents, without a category', () => {
    renderPage();
    fill({ keyword: '  road bike ', price: '499.99' });
    submit();

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]?.[0]).toEqual({
      keyword: 'road bike',
      max_price_cents: 49999,
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rounds fractional cents to the nearest cent', () => {
    renderPage();
    fill({ keyword: 'kayak', price: '19.999' });
    submit();

    expect(createMutate.mock.calls[0]?.[0]).toEqual({ keyword: 'kayak', max_price_cents: 2000 });
  });

  it('includes category_id when a category is chosen', () => {
    categoriesState.data = [{ id: 'c-2', name: 'Boats' }];
    renderPage();
    fill({ keyword: 'kayak', price: '300', category: 'c-2' });
    submit();

    expect(createMutate.mock.calls[0]?.[0]).toEqual({
      keyword: 'kayak',
      max_price_cents: 30000,
      category_id: 'c-2',
    });
  });

  it('resets the form when the mutation reports success', () => {
    categoriesState.data = [{ id: 'c-2', name: 'Boats' }];
    renderPage();
    fill({ keyword: 'kayak', price: '300', category: 'c-2' });
    submit();

    // Still populated until the server confirms.
    expect(keywordInput()).toHaveValue('kayak');

    const options = createMutate.mock.calls[0]?.[1];
    act(() => {
      options?.onSuccess();
    });

    expect(keywordInput()).toHaveValue('');
    expect(priceInput()).toHaveValue(null);
    expect(categorySelect()).toHaveValue('');
  });

  it('clears a previous validation error on a later valid submit', () => {
    renderPage();
    submit();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fill({ keyword: 'kayak', price: '10' });
    submit();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('disables the submit button and shows "Adding…" while the create is pending', () => {
    createState.isPending = true;
    renderPage();

    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add to wishlist' })).toBeNull();
  });
});
