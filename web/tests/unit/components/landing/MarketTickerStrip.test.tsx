import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketTickerStrip } from '@/components/landing/MarketTickerStrip';

vi.mock('@/hooks/usePricing', () => ({
  usePricingOverview: vi.fn(),
}));

const { usePricingOverview } = await import('@/hooks/usePricing');

const baseItems = [
  {
    category: 'Plumbing',
    location: 'Austin',
    currentPrice: 25000,
    originalPrice: 50000,
    bidCount: 4,
    status: 'active' as const,
  },
  {
    category: 'Electrical',
    location: 'Denver',
    currentPrice: 18000,
    bidCount: 2,
    timeRemaining: '5m left',
    status: 'ending-soon' as const,
  },
  {
    category: 'HVAC',
    location: 'Phoenix',
    currentPrice: 30000,
    status: 'completed' as const,
  },
];

describe('MarketTickerStrip', () => {
  beforeEach(() => {
    // Default: hook returns idle/empty, so explicit `items` props are exercised.
    vi.mocked(usePricingOverview).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePricingOverview>);
  });

  it('renders categories and locations from the items list', () => {
    render(<MarketTickerStrip items={baseItems} />);
    // Items are duplicated for the loop, so each appears twice
    expect(screen.getAllByText('Plumbing').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Austin').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Denver').length).toBeGreaterThanOrEqual(1);
  });

  it('formats prices in whole dollars', () => {
    render(<MarketTickerStrip items={baseItems} />);
    expect(screen.getAllByText('$250').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$500').length).toBeGreaterThanOrEqual(1); // original price
  });

  it('shows bid count chips when provided', () => {
    render(<MarketTickerStrip items={baseItems} />);
    expect(screen.getAllByText('4 bids').length).toBeGreaterThanOrEqual(1);
  });

  it('shows time remaining for ending-soon items', () => {
    render(<MarketTickerStrip items={baseItems} />);
    expect(screen.getAllByText('5m left').length).toBeGreaterThanOrEqual(1);
  });

  it('uses the configured speed duration', () => {
    const { container } = render(<MarketTickerStrip items={baseItems} speed="fast" />);
    const track = container.querySelector<HTMLElement>('.ticker-track');
    expect(track).not.toBeNull();
    expect(track?.style.animationDuration).toBe('25s');
  });

  it('exposes an aria-label on the marquee container', () => {
    const { container } = render(<MarketTickerStrip items={baseItems} />);
    expect(container.querySelector('[aria-label="Live marketplace activity"]')).not.toBeNull();
  });

  it('accepts an empty items list without crashing', () => {
    expect(() => render(<MarketTickerStrip items={[]} />)).not.toThrow();
  });

  describe('with no items prop (real-data mode)', () => {
    it('renders a skeleton while pricing data is loading', () => {
      vi.mocked(usePricingOverview).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      } as unknown as ReturnType<typeof usePricingOverview>);
      const { container } = render(<MarketTickerStrip />);
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    it('hides the strip gracefully when the pricing API errors', () => {
      vi.mocked(usePricingOverview).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      } as unknown as ReturnType<typeof usePricingOverview>);
      const { container } = render(<MarketTickerStrip />);
      expect(container.firstChild).toBeNull();
    });

    it('renders real category data when the hook resolves', () => {
      vi.mocked(usePricingOverview).mockReturnValue({
        data: {
          categories: [
            {
              category_name: 'Plumbing',
              category_slug: 'plumbing',
              total_jobs: 42,
              avg_median_cents: 25000,
              avg_savings_cents: 10000,
            },
            {
              category_name: 'Electrical',
              category_slug: 'electrical',
              total_jobs: 8,
              avg_median_cents: 18000,
              avg_savings_cents: null,
            },
          ],
        },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof usePricingOverview>);
      render(<MarketTickerStrip />);
      expect(screen.getAllByText('Plumbing').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Electrical').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('$250').length).toBeGreaterThanOrEqual(1);
    });

    it('hides when the API returns no usable categories', () => {
      vi.mocked(usePricingOverview).mockReturnValue({
        data: { categories: [] },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof usePricingOverview>);
      const { container } = render(<MarketTickerStrip />);
      expect(container.firstChild).toBeNull();
    });
  });
});
