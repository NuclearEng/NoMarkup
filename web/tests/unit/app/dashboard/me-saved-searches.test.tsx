// /me/saved-searches page — covers loading, error, empty, success, delete,
// and the polymorphic query summary (string vs object). The saved-search
// hooks were orphaned before this page existed (Bug 2).
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';
import type { SavedSearch } from '@/hooks/useWatchlist';

const savedState: {
  data: { saved_searches: SavedSearch[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

const deleteMutate = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/me/saved-searches',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

// Mock only the data hooks; keep the real (pure) string-or-object guards so
// the polymorphic query rendering is exercised for real.
vi.mock('@/hooks/useWatchlist', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useWatchlist')>('@/hooks/useWatchlist');
  return {
    ...actual,
    useSavedSearches: () => savedState,
    useDeleteSavedSearch: () => ({ mutate: deleteMutate, isPending: false }),
  };
});

import SavedSearchesPage from '@/app/(dashboard)/me/saved-searches/page';

function makeSearch(over: Partial<SavedSearch>): SavedSearch {
  return {
    id: 'ss-1',
    user_id: 'u-1',
    name: 'My search',
    query: 'cameras',
    alert_frequency: 'daily',
    last_run_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function renderPage() {
  return render(withQueryClient(createElement(SavedSearchesPage)));
}

beforeEach(() => {
  savedState.data = undefined;
  savedState.isLoading = false;
  savedState.isError = false;
  savedState.refetch = vi.fn();
  deleteMutate.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('SavedSearchesPage', () => {
  it('renders skeletons while loading', () => {
    savedState.isLoading = true;
    const { container } = renderPage();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the error state and Retry invokes refetch', () => {
    const refetch = vi.fn();
    savedState.isError = true;
    savedState.refetch = refetch;
    renderPage();
    expect(screen.getByText(/Failed to load saved searches/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state when there are no saved searches', () => {
    savedState.data = { saved_searches: [] };
    renderPage();
    expect(screen.getByText(/No saved searches yet/i)).toBeDefined();
  });

  it('renders a legacy string query without crashing', () => {
    savedState.data = { saved_searches: [makeSearch({ name: 'Legacy', query: 'vintage cameras' })] };
    renderPage();
    expect(screen.getByText('Legacy')).toBeDefined();
    expect(screen.getByText('"vintage cameras"')).toBeDefined();
  });

  it('renders a new-row object query ({ q, category }) without crashing', () => {
    savedState.data = {
      saved_searches: [makeSearch({ name: 'New', query: { q: 'desk', category: 'furniture' } })],
    };
    renderPage();
    expect(screen.getByText('New')).toBeDefined();
    expect(screen.getByText('"desk" · in furniture')).toBeDefined();
  });

  it('deletes a saved search when the trash button is clicked', () => {
    savedState.data = { saved_searches: [makeSearch({ id: 'ss-42', name: 'Drop me' })] };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Delete saved search Drop me/i }));
    expect(deleteMutate).toHaveBeenCalledWith('ss-42');
  });
});
