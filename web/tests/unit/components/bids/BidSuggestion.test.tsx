import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BidSuggestion } from '@/components/bids/BidSuggestion';

vi.mock('@/hooks/usePricing', () => ({
  usePricingByCategory: vi.fn(),
}));

const { usePricingByCategory } = await import('@/hooks/usePricing');

describe('BidSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while loading', () => {
    vi.mocked(usePricingByCategory).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof usePricingByCategory>);
    const { container } = render(<BidSuggestion categorySlug="plumbing" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when prices array is empty', () => {
    vi.mocked(usePricingByCategory).mockReturnValue({
      data: { prices: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof usePricingByCategory>);
    const { container } = render(<BidSuggestion categorySlug="plumbing" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows market range and completed jobs when data is present', () => {
    vi.mocked(usePricingByCategory).mockReturnValue({
      data: {
        prices: [
          {
            p25_price_cents: 15000,
            p75_price_cents: 25000,
            completed_jobs: 12,
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePricingByCategory>);
    render(<BidSuggestion categorySlug="plumbing" zipCode="94110" />);
    expect(screen.getByText(/market insight/i)).toBeDefined();
    expect(screen.getByText(/Based on 12 completed jobs/)).toBeDefined();
    // The price range is rendered as $150–$250
    const range = screen.getByText(/\$150/);
    expect(range.textContent).toContain('$250');
  });

  // ---- DEEPENING TESTS ----

  it('uses singular "job" label when completed_jobs === 1', () => {
    vi.mocked(usePricingByCategory).mockReturnValue({
      data: {
        prices: [
          {
            p25_price_cents: 10000,
            p75_price_cents: 20000,
            completed_jobs: 1,
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePricingByCategory>);
    render(<BidSuggestion categorySlug="plumbing" />);
    // singular: "1 completed job" (no trailing 's')
    expect(screen.getByText(/Based on 1 completed job\b/)).toBeDefined();
  });

  it('renders nothing when first pricing entry is undefined (defensive guard)', () => {
    vi.mocked(usePricingByCategory).mockReturnValue({
      // prices array has length but the first entry is undefined-equivalent
      data: { prices: [undefined as unknown as never] },
      isLoading: false,
    } as unknown as ReturnType<typeof usePricingByCategory>);
    const { container } = render(<BidSuggestion categorySlug="plumbing" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when data is undefined', () => {
    vi.mocked(usePricingByCategory).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof usePricingByCategory>);
    const { container } = render(<BidSuggestion categorySlug="plumbing" />);
    expect(container.firstChild).toBeNull();
  });
});
