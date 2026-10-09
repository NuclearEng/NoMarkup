import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MonoPrice } from '@/components/ui/mono-price';

describe('MonoPrice', () => {
  it('formats integer cents as USD', () => {
    render(<MonoPrice cents={1250} />);
    expect(screen.getByText('$12.50')).toBeInTheDocument();
  });

  it('renders an em dash for null/undefined/non-finite', () => {
    const { rerender } = render(<MonoPrice cents={null} />);
    expect(screen.getByText('\u2014')).toBeInTheDocument();
    rerender(<MonoPrice cents={undefined} />);
    expect(screen.getByText('\u2014')).toBeInTheDocument();
    rerender(<MonoPrice cents={Number.NaN} />);
    expect(screen.getByText('\u2014')).toBeInTheDocument();
  });

  it('applies mono tabular classes for terminal density', () => {
    const { container } = render(<MonoPrice cents={100} className="text-lg" />);
    const el = container.firstElementChild;
    expect(el?.className).toMatch(/font-mono/);
    expect(el?.className).toMatch(/tabular-nums/);
    expect(el?.className).toMatch(/text-lg/);
  });
});
