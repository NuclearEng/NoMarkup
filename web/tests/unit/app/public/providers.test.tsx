// Tests the providers index page in three states: loading, empty, and success.
import { render, screen } from '@testing-library/react';
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
});
