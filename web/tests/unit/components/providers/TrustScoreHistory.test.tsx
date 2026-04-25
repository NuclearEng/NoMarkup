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
});
