import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrustScoreHistory } from '@/components/providers/TrustScoreHistory';
import { TRUST_TIER, type TrustScoreSnapshot } from '@/types';

vi.mock('@/hooks/useTrustScore', () => ({
  useTrustHistory: vi.fn(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
  })),
}));

const { useTrustHistory } = await import('@/hooks/useTrustScore');

const snapshot = (
  over: number,
  prev: number,
  recordedAt = '2026-04-15T12:00:00Z',
): TrustScoreSnapshot => ({
  score: {
    user_id: 'u-1',
    overall_score: over,
    tier: TRUST_TIER.TRUSTED,
    feedback_score: 0.8,
    volume_score: 0.7,
    risk_score: 0.85,
    fraud_score: 0.75,
    data_points: 10,
    computed_at: '2026-04-01T00:00:00Z',
  },
  change_reason: 'New 5-star review',
  previous_overall: prev,
  previous_tier: TRUST_TIER.TRUSTED,
  recorded_at: recordedAt,
});

describe('TrustScoreHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Score History title with skeleton in loading state', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    const { container } = render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText('Score History')).toBeDefined();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the error message when loading fails', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText('boom')).toBeDefined();
  });

  it('renders empty state when no snapshots are returned', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: { snapshots: [], pagination: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText(/No score history available yet/)).toBeDefined();
  });

  it('renders a snapshot entry with change reason and percent', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [snapshot(0.78, 0.7)],
        pagination: { totalCount: 1, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText('New 5-star review')).toBeDefined();
    expect(screen.getByText('78%')).toBeDefined();
  });

  it('renders pagination total count label', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [
          snapshot(0.78, 0.7, '2026-04-15T12:00:00Z'),
          snapshot(0.7, 0.6, '2026-04-10T12:00:00Z'),
        ],
        pagination: { totalCount: 2, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText('2 changes')).toBeDefined();
  });

  it('renders singular "change" label when totalCount is 1', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [snapshot(0.78, 0.7)],
        pagination: { totalCount: 1, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText('1 change')).toBeDefined();
  });

  it('renders a positive delta arrow and tier-change badge', () => {
    // delta = 0.78 - 0.7 = +0.08 → +8%, isPositive true
    const positiveTierChange: TrustScoreSnapshot = {
      ...snapshot(0.78, 0.7),
      previous_tier: TRUST_TIER.RISING, // tier change → TRUSTED
    };
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [positiveTierChange],
        pagination: { totalCount: 1, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    // Positive delta badge: "↑+8%"
    expect(screen.getByText(/\+8%/)).toBeDefined();
    // Tier change arrow: "Rising → Trusted"
    expect(screen.getByText(/Rising/)).toBeDefined();
    expect(screen.getByText(/Trusted/)).toBeDefined();
  });

  it('renders a negative delta arrow', () => {
    // delta = 0.6 - 0.78 = -0.18 → -18%
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [snapshot(0.6, 0.78)],
        pagination: { totalCount: 1, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    const { container } = render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText(/-18%/)).toBeDefined();
    // Down-arrow class branch: bg-red-500 indicator dot
    expect(container.querySelector('.bg-red-500')).not.toBeNull();
  });

  it('renders the score range summary when more than one snapshot', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [
          snapshot(0.85, 0.78, '2026-04-15T12:00:00Z'),
          snapshot(0.78, 0.6, '2026-04-10T12:00:00Z'),
          snapshot(0.6, 0.5, '2026-04-05T12:00:00Z'),
        ],
        pagination: { totalCount: 3, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    // Range row: 60% – 85%
    expect(screen.getByText(/Range:/)).toBeDefined();
    // Net positive change: latest 0.85 minus oldest 0.6 = +0.25 → +25%
    expect(screen.getByText(/Net: \+25%/)).toBeDefined();
  });

  it('renders the score range summary with negative net change', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [
          snapshot(0.5, 0.6, '2026-04-15T12:00:00Z'),
          snapshot(0.6, 0.7, '2026-04-10T12:00:00Z'),
          snapshot(0.8, 0.85, '2026-04-05T12:00:00Z'),
        ],
        pagination: { totalCount: 3, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    // Net negative: latest 0.5 minus oldest 0.8 = -0.30 → -30%
    expect(screen.getByText(/Net: -30%/)).toBeDefined();
  });

  it('renders the score range summary with zero net change', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: {
        snapshots: [
          snapshot(0.7, 0.7, '2026-04-15T12:00:00Z'),
          snapshot(0.7, 0.7, '2026-04-10T12:00:00Z'),
        ],
        pagination: { totalCount: 2, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText(/Net: 0%/)).toBeDefined();
  });

  it('omits the totalCount label when pagination is missing', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: { snapshots: [snapshot(0.78, 0.7)], pagination: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    // Header still renders the title, but no "N change(s)" label
    expect(screen.getByText('Score History')).toBeDefined();
    expect(screen.queryByText(/change/)).toBeNull();
  });

  it('renders default error message when error is not an Error instance', () => {
    vi.mocked(useTrustHistory).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: 'plain string error',
    } as unknown as ReturnType<typeof useTrustHistory>);
    render(<TrustScoreHistory userId="u-1" />);
    expect(screen.getByText(/Failed to load score history/)).toBeDefined();
  });
});
