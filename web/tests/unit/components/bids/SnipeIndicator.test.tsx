import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SnipeIndicator } from '@/components/bids/SnipeIndicator';

describe('SnipeIndicator', () => {
  it('renders Ready state with 0 used extensions', () => {
    render(<SnipeIndicator count={0} max={3} />);
    expect(screen.getByText('Ready')).toBeDefined();
    expect(screen.getByText('0/3 extensions')).toBeDefined();
  });

  it('renders Active state when count > 0', () => {
    render(<SnipeIndicator count={2} max={3} />);
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('2/3 extensions')).toBeDefined();
  });

  it('exposes accessible label describing the current state', () => {
    render(<SnipeIndicator count={1} max={3} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-label')).toContain('1 of 3');
  });

  it('renders one segment dot per max extension', () => {
    const { container } = render(<SnipeIndicator count={1} max={5} />);
    // Each dot is a 2.5x2.5 rounded div — count by class
    const dots = container.querySelectorAll('div.h-2\\.5.w-2\\.5');
    expect(dots).toHaveLength(5);
  });
});
