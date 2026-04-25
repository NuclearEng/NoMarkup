import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TrustScoreBreakdown } from '@/components/providers/TrustScoreBreakdown';
import { TRUST_TIER, type TierRequirement, type TrustScore } from '@/types';

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

const mockScore: TrustScore = {
  user_id: 'u-1',
  overall_score: 0.78,
  tier: TRUST_TIER.TRUSTED,
  feedback_score: 0.8,
  volume_score: 0.7,
  risk_score: 0.85,
  fraud_score: 0.75,
  data_points: 42,
  computed_at: '2026-04-01T00:00:00Z',
};

const tierRequirements: TierRequirement[] = [
  {
    tier: TRUST_TIER.TOP_RATED,
    min_overall_score: 0.9,
    min_completed_jobs: 100,
    min_reviews: 50,
    min_rating: 4.8,
    requires_verification: true,
    description: 'Reach the top 5% of providers.',
  },
];

describe('TrustScoreBreakdown', () => {
  it('renders the Trust Score heading', () => {
    render(<TrustScoreBreakdown score={mockScore} />);
    expect(screen.getByText('Trust Score')).toBeDefined();
  });

  it('renders overall percent (78%) twice (in circle and label)', () => {
    render(<TrustScoreBreakdown score={mockScore} />);
    // visible: "78" in circle and "78%" in body
    expect(screen.getByText('78')).toBeDefined();
    expect(screen.getByText('78%')).toBeDefined();
  });

  it('shows data point pluralization', () => {
    render(<TrustScoreBreakdown score={mockScore} />);
    expect(screen.getByText(/Based on 42 data points/)).toBeDefined();
  });

  it('renders all dimension labels', () => {
    render(<TrustScoreBreakdown score={mockScore} />);
    expect(screen.getByText(/Feedback/)).toBeDefined();
    expect(screen.getByText(/Volume/)).toBeDefined();
    expect(screen.getByText(/Safety/)).toBeDefined();
    expect(screen.getByText(/Account Health/)).toBeDefined();
  });

  it('renders the next tier requirements when provided', () => {
    render(
      <TrustScoreBreakdown score={mockScore} tierRequirements={tierRequirements} />,
    );
    expect(screen.getByText(/Requirements for Top Rated/)).toBeDefined();
    expect(screen.getByText(/Reach the top 5%/)).toBeDefined();
    expect(screen.getByText(/Identity verification required/)).toBeDefined();
  });

  it('omits next tier section when no requirements provided', () => {
    render(<TrustScoreBreakdown score={mockScore} />);
    expect(screen.queryByText(/Requirements for/)).toBeNull();
  });
});
