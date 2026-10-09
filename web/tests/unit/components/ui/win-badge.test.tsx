import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WinBadge } from '@/components/ui/win-badge';

describe('WinBadge', () => {
  it('renders the default label for the awarded type', () => {
    render(<WinBadge type="awarded" />);
    expect(screen.getByText('Awarded')).toBeDefined();
  });

  it('renders a custom label when provided', () => {
    render(<WinBadge type="lowest" label="Best Bid" />);
    expect(screen.getByText('Best Bid')).toBeDefined();
  });

  it('exposes the label via aria-label', () => {
    render(<WinBadge type="best-value" />);
    expect(screen.getByLabelText('Best Value')).toBeDefined();
  });

  it('forwards className', () => {
    render(<WinBadge type="savings-milestone" className="my-win" />);
    expect(screen.getByLabelText('Savings').className).toContain('my-win');
  });

  it('applies animate class when animate is true', () => {
    render(<WinBadge type="awarded" animate />);
    expect(screen.getByLabelText('Awarded').className).toContain('animate');
  });
});
