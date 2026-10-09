import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SnipeExtensionBanner } from '@/components/marketplace/SnipeExtensionBanner';

describe('SnipeExtensionBanner', () => {
  it('renders the auction-extended headline', () => {
    render(
      <SnipeExtensionBanner
        extensionCount={1}
        newEndTime={new Date(Date.now() + 60_000).toISOString()}
      />,
    );
    expect(screen.getByText(/Auction extended/i)).toBeDefined();
  });

  it('renders the extension count when greater than one', () => {
    render(
      <SnipeExtensionBanner
        extensionCount={3}
        newEndTime={new Date(Date.now() + 60_000).toISOString()}
      />,
    );
    expect(screen.getByText(/×3/)).toBeDefined();
  });

  it('returns null when extensionCount is 0', () => {
    const { container } = render(
      <SnipeExtensionBanner
        extensionCount={0}
        newEndTime={new Date().toISOString()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('exposes role=status for assistive tech', () => {
    render(
      <SnipeExtensionBanner
        extensionCount={1}
        newEndTime={new Date(Date.now() + 60_000).toISOString()}
      />,
    );
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders the new end time in a readable format', () => {
    const future = new Date(Date.now() + 5 * 60_000);
    render(
      <SnipeExtensionBanner extensionCount={1} newEndTime={future.toISOString()} />,
    );
    expect(screen.getByText(/auction now ends at/i)).toBeDefined();
  });
});
