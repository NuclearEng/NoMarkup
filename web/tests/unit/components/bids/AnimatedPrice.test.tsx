import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
