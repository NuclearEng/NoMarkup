import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';

describe('AnimatedIllustration', () => {
  it('renders the no-jobs illustration with accessible label', () => {
    render(<AnimatedIllustration type="no-jobs" />);
    expect(screen.getByLabelText('No jobs found')).toBeDefined();
  });

  it('renders the no-bids illustration', () => {
    render(<AnimatedIllustration type="no-bids" />);
    expect(screen.getByLabelText('No bids placed')).toBeDefined();
  });

  it('renders the error illustration', () => {
    render(<AnimatedIllustration type="error" />);
    expect(screen.getByLabelText('Error occurred')).toBeDefined();
  });

  it('forwards className to the wrapper', () => {
    const { container } = render(
      <AnimatedIllustration type="search-empty" className="my-illo" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-illo');
  });

  it('respects size prop on the SVG dimensions', () => {
    render(<AnimatedIllustration type="no-messages" size="lg" />);
    const svg = screen.getByLabelText('No messages');
    expect(svg.getAttribute('width')).toBe('160');
    expect(svg.getAttribute('height')).toBe('160');
  });
});
