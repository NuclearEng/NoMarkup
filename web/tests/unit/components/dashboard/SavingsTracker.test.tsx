import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SavingsTracker } from '@/components/dashboard/SavingsTracker';

vi.mock('@/hooks/useBids', () => ({
  useSavings: vi.fn(),
}));

const { useSavings } = await import('@/hooks/useBids');
const useSavingsMock = vi.mocked(useSavings);

describe('SavingsTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton while loading', () => {
    useSavingsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useSavings>);

    const { container } = render(createElement(SavingsTracker));
    expect(container.querySelectorAll('div').length).toBeGreaterThan(0);
  });

  it('returns null when there are no savings rows', () => {
    useSavingsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useSavings>);

    const { container } = render(createElement(SavingsTracker));
    expect(container.firstChild).toBeNull();
  });

  it('renders total savings and job count when data is available', () => {
    useSavingsMock.mockReturnValue({
      data: [
        { savings_cents: 25_000 },
        { savings_cents: 50_000 },
        { savings_cents: 75_000 },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useSavings>);

    render(createElement(SavingsTracker));

    expect(screen.getByText('Your Savings')).toBeDefined();
    expect(screen.getByText('$1,500')).toBeDefined();
    expect(screen.getByText(/saved across 3 jobs/)).toBeDefined();
    expect(screen.getByText(/vs. market median/)).toBeDefined();
  });

  it('uses singular "job" when only one savings row', () => {
    useSavingsMock.mockReturnValue({
      data: [{ savings_cents: 12_345 }],
      isLoading: false,
    } as unknown as ReturnType<typeof useSavings>);

    render(createElement(SavingsTracker));
    expect(screen.getByText(/saved across 1 job\b/)).toBeDefined();
  });

  it('hides the market-median callout when total savings are zero', () => {
    useSavingsMock.mockReturnValue({
      data: [{ savings_cents: 0 }, { savings_cents: 0 }],
      isLoading: false,
    } as unknown as ReturnType<typeof useSavings>);

    render(createElement(SavingsTracker));
    // Card still renders, but the trending-down callout is hidden when total is 0.
    expect(screen.getByText('Your Savings')).toBeDefined();
    expect(screen.queryByText(/vs\. market median/)).toBeNull();
  });
});
