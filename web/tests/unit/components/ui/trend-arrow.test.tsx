import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TrendArrow } from '@/components/ui/trend-arrow';

describe('TrendArrow', () => {
  it('renders the optional label', () => {
    render(<TrendArrow value={5} label="+5%" />);
    expect(screen.getByText('+5%')).toBeDefined();
  });

  it('uses No change aria-label for neutral value', () => {
    render(<TrendArrow value={0} />);
    expect(screen.getByLabelText('No change')).toBeDefined();
  });

  it('uses Positive trend aria-label for positive value', () => {
    render(<TrendArrow value={10} label="up" />);
    expect(screen.getByLabelText('Positive trend: up')).toBeDefined();
  });

  it('uses Negative trend aria-label for negative value', () => {
    render(<TrendArrow value={-3} label="down" />);
    expect(screen.getByLabelText('Negative trend: down')).toBeDefined();
  });

  it('forwards className', () => {
    render(<TrendArrow value={1} label="x" className="my-trend" />);
    expect(screen.getByText('x').parentElement?.className).toContain('my-trend');
  });
});
