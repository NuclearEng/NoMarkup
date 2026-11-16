import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMutateAsync = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sell/new',
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: ({ alt, src, ...rest }: { alt: string; src: string }) =>
    createElement('img', { alt, src, ...rest }),
}));

vi.mock('@/hooks/useListings', () => ({
  useCreateListing: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

// The category step now uses the DB-driven GoodsCategorySelector
// (useGoodsCategoryTree → useCategoryTree → useQuery). Stub it with a small
// deterministic tree so the picker renders its category buttons instead of the
// "Loading categories…" placeholder.
vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ data: [], isLoading: false, isError: false }),
  useGoodsCategoryTree: () => ({
    data: [
      {
        id: 'goods-furniture',
        parentId: 'goods',
        name: 'Furniture',
        slug: 'furniture',
        level: 2,
        description: null,
        icon: null,
        sortOrder: 0,
        children: [],
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ListingPostingForm } from '@/components/marketplace/ListingPostingForm';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function withClient(node: ReactNode) {
  return createElement(QueryClientProvider, { client: createTestQueryClient() }, node);
}

beforeEach(() => {
  mockMutateAsync.mockReset();
  mockPush.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ListingPostingForm', () => {
  it('starts on step 1 (Photos)', () => {
    render(withClient(createElement(ListingPostingForm)));
    expect(screen.getByText(/Step 1 of 6/)).toBeDefined();
    expect(screen.getByText(/Photos — Start with 1–10 photos/)).toBeDefined();
  });

  it('shows progress bar with correct aria-label', () => {
    render(withClient(createElement(ListingPostingForm)));
    expect(screen.getByLabelText(/Listing creation progress/i)).toBeDefined();
  });

  it('Back button is disabled on step 1', () => {
    render(withClient(createElement(ListingPostingForm)));
    const back = screen.getByRole('button', { name: /Back/i });
    if (!(back instanceof HTMLButtonElement)) throw new Error('expected button');
    expect(back.disabled).toBe(true);
  });

  it('blocks Next when no photo has been added', async () => {
    const user = userEvent.setup();
    render(withClient(createElement(ListingPostingForm)));
    await user.click(screen.getByRole('button', { name: /^Next/i }));
    expect(await screen.findByText('At least one photo is required')).toBeDefined();
    expect(screen.getByText(/Step 1 of 6/)).toBeDefined();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('renders without throwing when given an onPublishSuccess callback', () => {
    const onPublishSuccess = vi.fn();
    render(
      withClient(
        createElement(ListingPostingForm, { onPublishSuccess } as Record<string, unknown>),
      ),
    );
    expect(onPublishSuccess).not.toHaveBeenCalled();
  });

  it('renders the photo dropzone with an accessible region label on step 1', () => {
    render(withClient(createElement(ListingPostingForm)));
    expect(screen.getByRole('region', { name: 'Drag and drop photos here' })).toBeDefined();
    expect(screen.getByLabelText('Upload listing photos')).toBeDefined();
    // The promise the wizard makes about the analysis, before any photo.
    expect(
      screen.getByText(/suggest a category, title, description, and starting price/),
    ).toBeDefined();
  });
});
