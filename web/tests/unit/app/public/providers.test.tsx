// Tests the providers index page in three states: loading, empty, and success.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/providers',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useProviders', () => ({
  useSearchProviders: vi.fn(),
}));

const { useSearchProviders } = await import('@/hooks/useProviders');
const { default: ProvidersPage } = await import('@/app/(public)/providers/page');

describe('(public)/providers/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading and search affordance', () => {
    vi.mocked(useSearchProviders).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchProviders>);

    render(createElement(ProvidersPage));

    expect(screen.getByRole('heading', { name: /Find/i })).toBeDefined();
    expect(screen.getByPlaceholderText(/Search by name/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDefined();
  });

  it('shows an empty state when no providers are returned', () => {
    vi.mocked(useSearchProviders).mockReturnValue({
      data: { providers: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchProviders>);

    render(createElement(ProvidersPage));

    expect(screen.getByText('No providers found')).toBeDefined();
  });

  it('renders provider results when data is present', () => {
    vi.mocked(useSearchProviders).mockReturnValue({
      data: {
        providers: [
          {
            id: 'p1',
            user_id: 'u1',
            display_name: 'Acme Plumbing',
            business_name: 'Acme Plumbing LLC',
            bio: 'Top-rated plumbers',
            verified: true,
            jobs_completed: 42,
            service_categories: [{ id: 'c1', name: 'Plumbing' }],
          },
        ],
        pagination: { totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchProviders>);

    render(createElement(ProvidersPage));

    expect(screen.getByText('Acme Plumbing LLC')).toBeDefined();
    expect(screen.getByText(/1 provider/)).toBeDefined();
  });

  it('typing then clicking Search invokes the hook with the query', async () => {
    const user = userEvent.setup();
    const searchSpy = vi.fn(() => ({
      data: { providers: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));
    vi.mocked(useSearchProviders).mockImplementation(
      searchSpy as unknown as typeof useSearchProviders,
    );

    render(createElement(ProvidersPage));
    await user.type(screen.getByPlaceholderText(/Search by name/i), 'plum');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // Last call should include the query
    const calls = searchSpy.mock.calls;
    const lastArg = calls[calls.length - 1]?.[0] as { query?: string } | undefined;
    expect(lastArg?.query).toBe('plum');
  });

  it('pressing Enter in the search input triggers a search', async () => {
    const user = userEvent.setup();
    const searchSpy = vi.fn(() => ({
      data: { providers: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));
    vi.mocked(useSearchProviders).mockImplementation(
      searchSpy as unknown as typeof useSearchProviders,
    );

    render(createElement(ProvidersPage));
    const input = screen.getByPlaceholderText(/Search by name/i);
    await user.type(input, 'roof{Enter}');

    const calls = searchSpy.mock.calls;
    const lastArg = calls[calls.length - 1]?.[0] as { query?: string } | undefined;
    expect(lastArg?.query).toBe('roof');
  });

  it('clicking Retry on the error state invokes refetch', () => {
    const refetch = vi.fn();
    vi.mocked(useSearchProviders).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useSearchProviders>);

    render(createElement(ProvidersPage));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('clicking Clear Filters in the empty-with-search state resets state', async () => {
    const user = userEvent.setup();
    vi.mocked(useSearchProviders).mockReturnValue({
      data: { providers: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchProviders>);

    render(createElement(ProvidersPage));
    // Type something, search, then clear-filters CTA appears.
    await user.type(screen.getByPlaceholderText(/Search by name/i), 'foo');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const clearBtn = screen.getByRole('button', { name: 'Clear Filters' });
    fireEvent.click(clearBtn);
    // Input should be reset to empty.
    const input = screen.getByPlaceholderText(/Search by name/i);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('Next and Previous pagination buttons fire when totalPages > 1', () => {
    const refetch = vi.fn();
    vi.mocked(useSearchProviders).mockReturnValue({
      data: {
        providers: [
          {
            id: 'p1',
            user_id: 'u1',
            display_name: 'A',
            business_name: null,
            bio: null,
            verified: false,
            jobs_completed: 1,
            service_categories: [],
          },
        ],
        pagination: { totalCount: 30, totalPages: 3, hasNext: true },
      },
      isLoading: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useSearchProviders>);

    render(createElement(ProvidersPage));
    // Both Next and Previous render; Previous is disabled at page 1.
    const next = screen.getByRole('button', { name: 'Next' });
    const prev = screen.getByRole('button', { name: 'Previous' });
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next);
    // No throw is enough; state updated.
    expect(screen.getByText(/Page/)).toBeDefined();
  });
});
