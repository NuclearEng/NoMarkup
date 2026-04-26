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

  it('renders red border (score < 0.4)', () => {
    const lowScore: TrustScore = {
      ...mockScore,
      overall_score: 0.2,
      feedback_score: 0.1,
      volume_score: 0.2,
      risk_score: 0.3,
      fraud_score: 0.35,
      tier: TRUST_TIER.UNDER_REVIEW,
      data_points: 1,
    };
    const { container } = render(<TrustScoreBreakdown score={lowScore} />);
    // border-red-500 utility class should appear on the circle
    expect(container.querySelector('.border-red-500')).not.toBeNull();
    // bg-red-500 score bar (red branch in getScoreColor)
    expect(container.querySelector('.bg-red-500')).not.toBeNull();
    // Singular: 1 data point (not "data points")
    expect(screen.getByText(/Based on 1 data point$/)).toBeDefined();
  });

  it('renders amber border (0.4 <= score < 0.7)', () => {
    const midScore: TrustScore = {
      ...mockScore,
      overall_score: 0.5,
      feedback_score: 0.45,
      volume_score: 0.5,
      risk_score: 0.55,
      fraud_score: 0.6,
      tier: TRUST_TIER.RISING,
    };
    const { container } = render(<TrustScoreBreakdown score={midScore} />);
    expect(container.querySelector('.border-amber-500')).not.toBeNull();
    expect(container.querySelector('.bg-amber-500')).not.toBeNull();
  });

  it('renders met checkmark when overall_score meets next tier minimum', () => {
    // Score 0.95 meets the 0.9 min_overall_score for TOP_RATED
    const highScore: TrustScore = { ...mockScore, overall_score: 0.95 };
    render(
      <TrustScoreBreakdown score={highScore} tierRequirements={tierRequirements} />,
    );
    // The "met" checkmark span has aria-label="Requirement met"
    expect(screen.getByLabelText('Requirement met')).toBeDefined();
  });

  it('omits identity-verification line when not required by next tier', () => {
    const reqsNoVerify: TierRequirement[] = [
      {
        ...tierRequirements[0]!,
        requires_verification: false,
      },
    ];
    render(
      <TrustScoreBreakdown score={mockScore} tierRequirements={reqsNoVerify} />,
    );
    expect(screen.queryByText(/Identity verification required/)).toBeNull();
  });

  it('returns null next-tier when current tier is the highest', () => {
    const topScore: TrustScore = {
      ...mockScore,
      tier: TRUST_TIER.TOP_RATED,
      overall_score: 0.95,
    };
    render(
      <TrustScoreBreakdown score={topScore} tierRequirements={tierRequirements} />,
    );
    // No "Requirements for" section (already at top tier)
    expect(screen.queryByText(/Requirements for/)).toBeNull();
  });

  it('returns null next-tier when no matching requirement found', () => {
    // Currently TRUSTED → next is TOP_RATED, but tierRequirements doesn't include it
    const reqs: TierRequirement[] = [
      {
        tier: TRUST_TIER.RISING,
        min_overall_score: 0.5,
        min_completed_jobs: 10,
        min_reviews: 5,
        min_rating: 4.0,
        requires_verification: false,
        description: 'Rising tier description',
      },
    ];
    render(<TrustScoreBreakdown score={mockScore} tierRequirements={reqs} />);
    expect(screen.queryByText(/Requirements for/)).toBeNull();
  });
});
