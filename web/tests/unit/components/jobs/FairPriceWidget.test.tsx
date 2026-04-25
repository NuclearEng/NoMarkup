import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAnalytics', () => ({
  useMarketRange: vi.fn(),
}));

import { FairPriceWidget } from '@/components/jobs/FairPriceWidget';
import { useMarketRange } from '@/hooks/useAnalytics';

describe('FairPriceWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no market range data', () => {
    vi.mocked(useMarketRange).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useMarketRange>);
    const { container } = render(<FairPriceWidget categoryId="cat-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when fewer than 3 data points', () => {
    vi.mocked(useMarketRange).mockReturnValue({
      data: { low_cents: 1000, median_cents: 2000, high_cents: 3000, data_points: 2 },
    } as unknown as ReturnType<typeof useMarketRange>);
    const { container } = render(<FairPriceWidget categoryId="cat-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders price range labels when data is available', () => {
    vi.mocked(useMarketRange).mockReturnValue({
      data: {
        low_cents: 5000,
        median_cents: 10000,
        high_cents: 15000,
        data_points: 12,
      },
    } as unknown as ReturnType<typeof useMarketRange>);
    render(<FairPriceWidget categoryId="cat-1" />);
    expect(screen.getByText('Fair market')).toBeDefined();
    expect(screen.getByText(/Median:/)).toBeDefined();
    expect(screen.getByText(/Based on 12 local jobs/)).toBeDefined();
  });

  it('shows correct singular vs plural job count', () => {
    vi.mocked(useMarketRange).mockReturnValue({
      data: {
        low_cents: 5000,
        median_cents: 10000,
        high_cents: 15000,
        data_points: 3,
      },
    } as unknown as ReturnType<typeof useMarketRange>);
    render(<FairPriceWidget categoryId="cat-1" />);
    expect(screen.getByText(/Based on 3 local jobs/)).toBeDefined();
  });

  it('renders accessibly with aria-label', () => {
    vi.mocked(useMarketRange).mockReturnValue({
      data: {
        low_cents: 5000,
        median_cents: 10000,
        high_cents: 15000,
        data_points: 5,
      },
    } as unknown as ReturnType<typeof useMarketRange>);
    render(<FairPriceWidget categoryId="cat-1" currentLowestBidCents={8000} />);
    expect(screen.getByLabelText('Fair market price range')).toBeDefined();
  });
});
