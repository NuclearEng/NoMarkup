import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedPrice } from '@/components/bids/AnimatedPrice';

describe('AnimatedPrice', () => {
  it('renders an em dash when cents is 0', () => {
    render(<AnimatedPrice cents={0} />);
    // Em dash placeholder rendered when no value yet
    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders the formatted price digits when cents > 0', () => {
    const { container } = render(<AnimatedPrice cents={25000} />);
    // The price ($250) is split across multiple spans for the tumble
    // animation, so we assert the visible text content.
    expect(container.textContent).toContain('$');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('5');
    expect(container.textContent).toContain('0');
  });

  it('respects a custom formatCurrency function', () => {
    const fmt = (c: number) => `EUR ${String(c / 100)}`;
    const { container } = render(<AnimatedPrice cents={1500} formatCurrency={fmt} />);
    expect(container.textContent).toContain('E');
    expect(container.textContent).toContain('U');
    expect(container.textContent).toContain('R');
  });

  it('applies a custom className to the wrapper span', () => {
    const { container } = render(
      <AnimatedPrice cents={1000} className="text-red-500" />,
    );
    const wrapper = container.querySelector('span.text-red-500');
    expect(wrapper).not.toBeNull();
  });

  it('marks the wrapper as a polite live region', () => {
    const { container } = render(<AnimatedPrice cents={1000} />);
    const wrapper = container.querySelector('span[aria-live="polite"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute('aria-atomic')).toBe('true');
  });

  // ---- DEEPENING TESTS ----

  describe('animations', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('flashes green and renders rolling digits when the price drops', () => {
      const { container, rerender } = render(<AnimatedPrice cents={25000} />);
      // Allow the first-render initialization effect to commit
      act(() => {
        vi.advanceTimersByTime(0);
      });
      // Drop to a lower price — should flash green and animate digits.
      rerender(<AnimatedPrice cents={20000} />);
      const flashWrapper = container.querySelector('.animate-digit-flash-green');
      expect(flashWrapper).not.toBeNull();
      // The exiting digit slides up and out — exitChar/animation is rendered.
      const rollUp = container.querySelector('.animate-digit-roll-up');
      expect(rollUp).not.toBeNull();
      // After the animation duration the flash is cleared.
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(container.querySelector('.animate-digit-flash-green')).toBeNull();
    });

    it('flashes red when the price rises', () => {
      const { container, rerender } = render(<AnimatedPrice cents={20000} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      rerender(<AnimatedPrice cents={25000} />);
      const flashWrapper = container.querySelector('.animate-digit-flash-red');
      expect(flashWrapper).not.toBeNull();
    });

    it('renders the em-dash placeholder when the price drops to zero', () => {
      const { rerender } = render(<AnimatedPrice cents={25000} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      rerender(<AnimatedPrice cents={0} />);
      expect(screen.getByText('—')).toBeDefined();
    });

    it('uses padding so the new value digit count does not crash the renderer', () => {
      // Transition from 3-digit ($25) to 4-digit ($250) shifts character counts.
      const { container, rerender } = render(<AnimatedPrice cents={2500} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      rerender(<AnimatedPrice cents={25000} />);
      // No crash; wrapper renders.
      const wrapper = container.querySelector('span[aria-live="polite"]');
      expect(wrapper).not.toBeNull();
    });

    it('flashes red and uses an empty prevFormatted when transitioning from zero to a positive price', () => {
      // Mount with cents=0 (em-dash placeholder, prevCentsRef = 0).
      const { container, rerender } = render(<AnimatedPrice cents={0} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      // Rerender with a positive value → animateTransition runs with prevCents=0,
      // hitting the `prevCents > 0 ? ... : ''` false branch.
      rerender(<AnimatedPrice cents={5000} />);
      // 0 → 5000 is a price increase, so the wrapper flashes red.
      expect(container.querySelector('.animate-digit-flash-red')).not.toBeNull();
    });
  });
});
