// Tests for the pricing page — exercises overview loading/error/empty/populated
// branches, category-detail navigation, ZIP-code filter behavior, and the
// scroll-triggered useInView + AnimatedCounter (RAF) animations.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../dashboard/_helpers';

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

const overviewState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const categoryState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

// Captured IntersectionObserver callbacks (one per useInView call). Tests can
// invoke `fireAllIntersecting()` to drive every section's `inView` to true
// and unlock the AnimatedCounter / scroll-revealed branches (lines 31-35,
// 68-84 in PricingPageContent.tsx).
const ioCallbacks: IOCallback[] = [];
let unobservedCount = 0;
let disconnectedCount = 0;

function fireAllIntersecting(): void {
  // Iterate over a snapshot — firing may cause React to mount new components
  // that register additional observers, which would otherwise mutate the
  // array we are iterating.
  const snapshot = [...ioCallbacks];
  for (const cb of snapshot) {
    cb([{ isIntersecting: true } as IntersectionObserverEntry]);
  }
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/pricing',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/maps/PriceHeatMap', () => ({
  PriceHeatMap: () => createElement('div', { 'data-testid': 'price-heatmap' }),
}));

vi.mock('@/hooks/usePricing', () => ({
  usePricingOverview: () => overviewState,
  usePricingByCategory: () => categoryState,
}));

// Capturing IntersectionObserver — jsdom doesn't ship one. We capture every
// constructed callback so individual tests can drive the observer state.
beforeEach(() => {
  ioCallbacks.length = 0;
  unobservedCount = 0;
  disconnectedCount = 0;
  globalThis.IntersectionObserver = class {
    constructor(cb: IOCallback) {
      ioCallbacks.push(cb);
    }
    observe(): void {}
    disconnect(): void {
      disconnectedCount += 1;
    }
    unobserve(): void {
      unobservedCount += 1;
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  overviewState.data = undefined;
  overviewState.isLoading = false;
  overviewState.isError = false;
  categoryState.data = undefined;
  categoryState.isLoading = false;
  categoryState.isError = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

const { default: PricingPage } = await import('@/app/(public)/pricing/page');

const plumbing = {
  category_slug: 'plumbing',
  category_name: 'Plumbing',
  avg_median_cents: 25000,
  total_jobs: 12,
  avg_savings_cents: 8000,
};
const electrical = {
  category_slug: 'electrical',
  category_name: 'Electrical',
  avg_median_cents: 30000,
  total_jobs: 1,
  avg_savings_cents: null,
};

describe('PricingPage', () => {
  it('renders the hero, ZIP search, and heat map', () => {
    overviewState.data = { categories: [plumbing] };
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByLabelText(/filter by zip code/i)).toBeDefined();
    expect(screen.getByTestId('price-heatmap')).toBeDefined();
    expect(screen.getByRole('heading', { name: /Completed jobs by ZIP/i })).toBeDefined();
    expect(screen.queryByText('Illustrative')).toBeNull();
    expect(screen.getByText(/Completed jobs by ZIP \(where we have coordinates\)/i)).toBeDefined();
  });

  it('renders loading skeletons in the overview while loading', () => {
    overviewState.isLoading = true;
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByLabelText(/loading service categories/i)).toBeDefined();
  });

  it('renders error message when overview fails to load', () => {
    overviewState.isError = true;
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByText(/failed to load pricing data/i)).toBeDefined();
  });

  it('renders empty state when no categories returned', () => {
    overviewState.data = { categories: [] };
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByText(/no pricing data available yet/i)).toBeDefined();
  });

  it('renders one card per category in the overview', () => {
    overviewState.data = { categories: [plumbing, electrical] };
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByRole('button', { name: /view pricing for plumbing/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /view pricing for electrical/i })).toBeDefined();
    expect(screen.getByText(/12 jobs/)).toBeDefined();
    expect(screen.getByText(/^1 job$/)).toBeDefined();
  });

  it('switches to detail view when a category card is clicked', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = {
      prices: [
        {
          category_slug: 'plumbing',
          zip_code: '98101',
          median_price_cents: 25000,
          p25_price_cents: 18000,
          p75_price_cents: 32000,
          min_price_cents: 12000,
          max_price_cents: 50000,
          completed_jobs: 6,
          avg_savings_cents: 4000,
        },
      ],
    };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByRole('heading', { name: /plumbing\s*pricing/i })).toBeDefined();
    expect(screen.getByText('98101')).toBeDefined();
    expect(screen.getByRole('button', { name: /all categories/i })).toBeDefined();
  });

  it('returns to overview when "All categories" clicked', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = { prices: [] };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    fireEvent.click(screen.getByRole('button', { name: /all categories/i }));
    expect(screen.getByRole('button', { name: /view pricing for plumbing/i })).toBeDefined();
  });

  it('shows category-detail empty state when no rows for selected category', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = { prices: [] };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByText(/no pricing data available for this category/i)).toBeDefined();
  });

  it('shows category-detail error state when detail fetch fails', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.isError = true;
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByText(/failed to load pricing breakdown/i)).toBeDefined();
  });

  it('applies and clears the ZIP filter', () => {
    overviewState.data = { categories: [plumbing] };
    render(withQueryClient(createElement(PricingPage)));
    const input = screen.getByLabelText(/filter by zip code/i);
    fireEvent.change(input, { target: { value: '98101' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(screen.getByText(/showing prices for zip code/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /clear zip filter/i }));
    expect(screen.queryByText(/showing prices for zip code/i)).toBeNull();
  });

  it('renders detail loading skeletons when category data is loading', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.isLoading = true;
    const { container } = render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    // Detail-skeleton placeholders render with the h-60 class in the grid.
    expect(container.querySelectorAll('.h-60').length).toBeGreaterThan(0);
  });

  it('shows ZIP-specific empty state in detail when filter is set but no rows match', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = { prices: [] };
    render(withQueryClient(createElement(PricingPage)));
    // Apply a ZIP first.
    fireEvent.change(screen.getByLabelText(/filter by zip code/i), {
      target: { value: '99999' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    // Now drill into the category — its empty state should mention the ZIP.
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByText(/no pricing data for zip code 99999/i)).toBeDefined();
  });

  it('renders Avg savings line in PriceDetailCard when avg_savings_cents > 0', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = {
      prices: [
        {
          category_slug: 'plumbing',
          zip_code: '98101',
          median_price_cents: 25000,
          p25_price_cents: 18000,
          p75_price_cents: 32000,
          min_price_cents: 12000,
          max_price_cents: 50000,
          completed_jobs: 6,
          avg_savings_cents: 4500,
        },
      ],
    };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByText(/avg\. savings vs\. budget/i)).toBeDefined();
  });

  it('omits Avg savings line in PriceDetailCard when avg_savings_cents is null', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = {
      prices: [
        {
          category_slug: 'plumbing',
          zip_code: '98101',
          median_price_cents: 25000,
          p25_price_cents: 18000,
          p75_price_cents: 32000,
          min_price_cents: 12000,
          max_price_cents: 50000,
          completed_jobs: 6,
          avg_savings_cents: null,
        },
      ],
    };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.queryByText(/avg\. savings vs\. budget/i)).toBeNull();
  });

  it('triggers ZIP search via Enter key on the input', () => {
    overviewState.data = { categories: [plumbing] };
    render(withQueryClient(createElement(PricingPage)));
    const input = screen.getByLabelText(/filter by zip code/i);
    fireEvent.change(input, { target: { value: '90210' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/showing prices for zip code/i)).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────
  // IntersectionObserver + AnimatedCounter coverage
  // ────────────────────────────────────────────────────────────────────────

  it('flips the stats reveal classes once the section becomes intersecting', () => {
    overviewState.data = { categories: [plumbing, electrical] };
    const { container } = render(withQueryClient(createElement(PricingPage)));

    // Pre-intersection — the stats grid items carry the hidden classes.
    const before = container.querySelectorAll('.glass-stat-card');
    expect(before.length).toBeGreaterThan(0);
    expect(before[0]?.className).toContain('translate-y-6');

    act(() => {
      fireAllIntersecting();
    });

    const after = container.querySelectorAll('.glass-stat-card');
    expect(after[0]?.className).toContain('translate-y-0');
    expect(after[0]?.className).toContain('opacity-100');
  });

  it('calls observer.unobserve when a section enters the viewport', () => {
    overviewState.data = { categories: [plumbing] };
    render(withQueryClient(createElement(PricingPage)));
    expect(unobservedCount).toBe(0);

    act(() => {
      fireAllIntersecting();
    });

    expect(unobservedCount).toBeGreaterThanOrEqual(1);
  });

  it('disconnects observers on unmount', () => {
    overviewState.data = { categories: [plumbing] };
    const { unmount } = render(withQueryClient(createElement(PricingPage)));
    unmount();
    expect(disconnectedCount).toBeGreaterThanOrEqual(1);
  });

  it('AnimatedCounter renders the eased count once intersecting + RAF runs', () => {
    overviewState.data = {
      categories: [
        { ...plumbing, total_jobs: 42, avg_savings_cents: 12345 },
        { ...electrical, total_jobs: 11, avg_savings_cents: 9876 },
      ],
    };

    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length as unknown as number;
      });
    const cancelSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});

    const { container } = render(withQueryClient(createElement(PricingPage)));

    // Before the stats section is intersecting, the AnimatedCounter still
    // renders count=0; flipping inView=true triggers the useEffect that
    // schedules requestAnimationFrame (line 81 in PricingPageContent.tsx).
    act(() => {
      fireAllIntersecting();
    });

    expect(
      rafCallbacks.length,
      'expected at least one RAF scheduled by AnimatedCounter',
    ).toBeGreaterThan(0);

    // First frame establishes startTime for every counter.
    act(() => {
      const snapshot = [...rafCallbacks];
      rafCallbacks.length = 0;
      for (const cb of snapshot) cb(100);
    });

    // Drive every queued RAF past the 1800ms default duration so progress
    // saturates to 1 and `count` becomes `end`.
    for (let i = 0; i < 6; i += 1) {
      if (rafCallbacks.length === 0) break;
      act(() => {
        const snapshot = [...rafCallbacks];
        rafCallbacks.length = 0;
        for (const cb of snapshot) cb(100 + 5000);
      });
    }

    // The Jobs Tracked counter has end=53 (42 + 11). Average savings stat
    // expects $111 ((12345 + 9876)/2/100 = 111.105 → Math.round → 111).
    expect(container.textContent).toContain('53+');
    expect(container.textContent).toContain('$111');

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('AnimatedCounter cleans up RAF on unmount', () => {
    overviewState.data = { categories: [plumbing] };

    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 7 as unknown as number);
    const cancelSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});

    const { unmount } = render(withQueryClient(createElement(PricingPage)));
    act(() => {
      fireAllIntersecting();
    });

    unmount();
    // The AnimatedCounter cleanup path (line 83) calls cancelAnimationFrame.
    expect(cancelSpy).toHaveBeenCalled();

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('AnimatedCounter renders zero when categories give no savings (avg=0)', () => {
    // When avgSavings === 0, the page renders the static "—" branch instead of
    // mounting the AnimatedCounter, ensuring the avgSavings>0 branch is exercised
    // in a separate path while keeping coverage on the conditional.
    overviewState.data = {
      categories: [{ ...plumbing, avg_savings_cents: null, total_jobs: 5 }],
    };
    const { container } = render(withQueryClient(createElement(PricingPage)));
    // The em-dash is rendered when avgSavings <= 0.
    expect(container.textContent).toContain('—');
  });

  it('handles empty entries array without throwing in useInView', () => {
    overviewState.data = { categories: [plumbing] };
    render(withQueryClient(createElement(PricingPage)));
    // Source guards `entry?.isIntersecting` — empty array must not crash.
    act(() => {
      const snapshot = [...ioCallbacks];
      for (const cb of snapshot) {
        cb([] as IntersectionObserverEntry[]);
      }
    });
    expect(unobservedCount).toBe(0);
  });
});
