import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SavingsBadge } from '@/components/jobs/SavingsBadge';

describe('SavingsBadge', () => {
  it('renders savings text when lowest bid is below market median', () => {
    render(<SavingsBadge lowestBidCents={8000} marketMedianCents={10000} />);
    expect(screen.getByText(/Saves you/)).toBeDefined();
    expect(screen.getByText(/vs\. market avg/)).toBeDefined();
  });

  it('renders nothing when lowest bid equals market median', () => {
    const { container } = render(
      <SavingsBadge lowestBidCents={10000} marketMedianCents={10000} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when lowest bid is above market median', () => {
    const { container } = render(
      <SavingsBadge lowestBidCents={12000} marketMedianCents={10000} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('exposes accessible aria-label with the dollar saved', () => {
    render(<SavingsBadge lowestBidCents={8000} marketMedianCents={10000} />);
    const el = screen.getByLabelText(/Saves you \$20/);
    expect(el).toBeDefined();
  });

  it('forwards className', () => {
    render(
      <SavingsBadge
        lowestBidCents={8000}
        marketMedianCents={10000}
        className="custom-class"
      />,
    );
    expect(screen.getByLabelText(/Saves you/).className).toContain('custom-class');
  });
});
