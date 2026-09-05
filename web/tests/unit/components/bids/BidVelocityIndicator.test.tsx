import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BidVelocityIndicator } from '@/components/bids/BidVelocityIndicator';

describe('BidVelocityIndicator', () => {
  it('renders Quiet label when velocity is 0', () => {
    render(<BidVelocityIndicator velocity={0} buckets={[0, 0, 0, 0]} />);
    expect(screen.getByText('Quiet')).toBeDefined();
    expect(screen.getByText('0/m')).toBeDefined();
  });

  it('renders Cooling label for low velocity', () => {
    render(<BidVelocityIndicator velocity={2} buckets={[1, 1, 0, 1]} />);
    expect(screen.getByText('Cooling')).toBeDefined();
    expect(screen.getByText('2/m')).toBeDefined();
  });

  it('renders Heating up label for medium velocity', () => {
    render(<BidVelocityIndicator velocity={4} buckets={[2, 2, 2, 2]} />);
    expect(screen.getByText('Heating up')).toBeDefined();
  });

  it('renders Hot label for high velocity', () => {
    render(<BidVelocityIndicator velocity={8} buckets={[4, 4, 4, 4]} />);
    expect(screen.getByText('Hot')).toBeDefined();
  });

  it('exposes accessible label combining velocity and label', () => {
    render(<BidVelocityIndicator velocity={6} buckets={[3, 3, 3, 3]} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-label')).toContain('6');
    expect(region.getAttribute('aria-label')).toContain('Hot');
  });

  it('renders one bar per bucket', () => {
    const { container } = render(
      <BidVelocityIndicator velocity={3} buckets={[1, 2, 3, 4, 5]} />,
    );
    const bars = container.querySelectorAll('div.w-\\[2\\.5px\\]');
    expect(bars).toHaveLength(5);
  });
});
