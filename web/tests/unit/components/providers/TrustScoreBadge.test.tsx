import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TrustScoreBadge } from '@/components/providers/TrustScoreBadge';
import { TRUST_TIER } from '@/types';

// Tooltip uses Radix portals + pointer events; render content inline
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  TooltipTrigger: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  TooltipContent: ({ children }: { children: ReactNode }) =>
    createElement('div', { role: 'tooltip' }, children),
  TooltipProvider: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
}));

describe('TrustScoreBadge', () => {
  it('renders the Under Review label', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.UNDER_REVIEW} />);
    expect(screen.getAllByText('Under Review').length).toBeGreaterThan(0);
  });

  it('renders the New label', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.NEW} />);
    expect(screen.getAllByText('New').length).toBeGreaterThan(0);
  });

  it('renders the Rising label', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.RISING} />);
    expect(screen.getAllByText('Rising').length).toBeGreaterThan(0);
  });

  it('renders the Trusted label', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.TRUSTED} />);
    expect(screen.getAllByText('Trusted').length).toBeGreaterThan(0);
  });

  it('renders the Top Rated label', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.TOP_RATED} />);
    expect(screen.getAllByText('Top Rated').length).toBeGreaterThan(0);
  });

  it('shows score percentage when provided', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.TRUSTED} score={0.85} />);
    // 0.85 -> 85%
    expect(screen.getAllByText(/85%/).length).toBeGreaterThan(0);
  });

  it('omits score percentage when score is undefined', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.TRUSTED} />);
    // The visible badge label has no percent; aria-label has no score suffix.
    expect(screen.getByLabelText('Trust tier: Trusted')).toBeDefined();
  });

  it('exposes accessible label including tier', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.TRUSTED} score={0.5} />);
    expect(screen.getByLabelText(/Trust tier: Trusted/)).toBeDefined();
  });

  it('renders sm size variant', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.NEW} size="sm" />);
    expect(screen.getAllByText('New').length).toBeGreaterThan(0);
  });

  it('renders lg size variant with trust score subtitle', () => {
    render(<TrustScoreBadge tier={TRUST_TIER.TOP_RATED} score={0.95} size="lg" />);
    expect(screen.getAllByText('Top Rated').length).toBeGreaterThan(0);
    expect(screen.getByText(/95% trust score/)).toBeDefined();
  });
});
