import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContentLoader } from '@/components/ui/content-loader';

describe('ContentLoader', () => {
  it('renders a loading status region', () => {
    render(<ContentLoader preset="job-card" />);
    expect(screen.getByRole('status', { name: 'Loading content' })).toBeDefined();
  });

  it('includes screen-reader text', () => {
    render(<ContentLoader preset="bid-card" />);
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(
      <ContentLoader preset="stat-card" className="my-loader" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-loader');
  });

  it('renders the requested number of skeleton instances', () => {
    const { container } = render(<ContentLoader preset="message" count={3} />);
    // Each MessageSkeleton wraps content in a top-level div under the status region
    const root = container.firstChild as HTMLElement;
    expect(root.children.length).toBeGreaterThanOrEqual(3);
  });

  it('renders different presets without crashing', () => {
    const presets = ['profile', 'auction-arena', 'contract-card'] as const;
    for (const preset of presets) {
      const { unmount } = render(<ContentLoader preset={preset} />);
      expect(screen.getByRole('status')).toBeDefined();
      unmount();
    }
  });
});
