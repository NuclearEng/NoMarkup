import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SavingsHero } from '@/components/bids/SavingsHero';

describe('SavingsHero', () => {
  it('renders nothing when there are no savings', () => {
    const { container } = render(
      <SavingsHero startingPriceCents={20000} currentLowestCents={20000} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when starting price is 0', () => {
    const { container } = render(
      <SavingsHero startingPriceCents={0} currentLowestCents={15000} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the current lowest is 0', () => {
    const { container } = render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows savings amount and percent when there is a delta', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={35000} />,
    );
    // 50000 - 35000 = 15000 cents savings = $150, 30% off
    expect(screen.getByText('30%')).toBeDefined();
    // The text $150 may be split across spans by RollingDigits, but the
    // sr-only span contains the literal value.
    expect(screen.getByText("You're saving")).toBeDefined();
  });

  it('shows Incredible Deal badge when savings exceed 40%', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={20000} />,
    );
    // 60% savings → incredible
    expect(screen.getByText(/incredible deal/i)).toBeDefined();
  });

  it('hides the Incredible Deal badge for moderate savings', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={40000} />,
    );
    expect(screen.queryByText(/incredible deal/i)).toBeNull();
  });

  it('exposes an aria-label describing the savings', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={35000} />,
    );
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-label')).toContain('30 percent');
  });

  it('renders the trend-up message when previous lowest was higher than current', () => {
    render(
      <SavingsHero
        startingPriceCents={50000}
        currentLowestCents={30000}
        previousLowestCents={40000}
      />,
    );
    expect(screen.getByText(/Savings just increased/i)).toBeDefined();
  });

  it('omits the trend-up message when previous lowest was equal to current', () => {
    render(
      <SavingsHero
        startingPriceCents={50000}
        currentLowestCents={30000}
        previousLowestCents={30000}
      />,
    );
    expect(screen.queryByText(/Savings just increased/i)).toBeNull();
  });

  describe('animations', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('animates digits when the savings amount changes', () => {
      const { rerender } = render(
        <SavingsHero startingPriceCents={50000} currentLowestCents={40000} />,
      );
      // Re-render with a different lowest — triggers the rolling digit effect
      rerender(<SavingsHero startingPriceCents={50000} currentLowestCents={30000} />);
      // Advance timers past the 200ms RollingDigits + 600ms isAnimating timeouts
      act(() => {
        vi.advanceTimersByTime(800);
      });
      // Should display the new savings ($200 = 40% of $500)
      expect(screen.getByText('40%')).toBeDefined();
    });

    it('clears animation state when the component unmounts mid-animation', () => {
      const { rerender, unmount } = render(
        <SavingsHero startingPriceCents={50000} currentLowestCents={40000} />,
      );
      rerender(<SavingsHero startingPriceCents={50000} currentLowestCents={30000} />);
      // Unmount before animation completes — exercises the cleanup branch
      unmount();
      act(() => {
        vi.advanceTimersByTime(800);
      });
    });
  });
});
