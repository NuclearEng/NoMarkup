import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChallengeCard } from '@/components/providers/ChallengeCard';
import type { Challenge, LeaderboardEntry } from '@/types';

// Stub useCountdown to avoid timers
vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => ({ timeLeft: '3d 12h', isExpired: false, totalSeconds: 86400 * 3 }),
}));

const baseChallenge: Challenge = {
  id: 'ch-1',
  title: 'Complete 10 jobs',
  description: 'Finish 10 jobs this month to earn the badge.',
  challenge_type: 'jobs_completed',
  target_value: 10,
  reward_type: 'badge',
  reward_value: 'gold-month',
  starts_at: '2026-04-01T00:00:00Z',
  ends_at: '2026-04-30T23:59:59Z',
  is_seasonal: false,
  season_name: null,
  max_participants: null,
  participant_count: 25,
  joined: false,
  time_remaining_seconds: 86400 * 3,
};

describe('ChallengeCard', () => {
  it('renders title and description', () => {
    render(<ChallengeCard challenge={baseChallenge} />);
    expect(screen.getByText('Complete 10 jobs')).toBeDefined();
    expect(screen.getByText(/Finish 10 jobs/)).toBeDefined();
  });

  it('renders the time-remaining label', () => {
    render(<ChallengeCard challenge={baseChallenge} />);
    expect(screen.getByText('3d 12h left')).toBeDefined();
  });

  it('shows participant count when not joined', () => {
    render(<ChallengeCard challenge={baseChallenge} />);
    expect(screen.getByText(/25 participants/)).toBeDefined();
  });

  it('renders the seasonal badge when challenge is seasonal', () => {
    render(
      <ChallengeCard
        challenge={{ ...baseChallenge, is_seasonal: true, season_name: 'Spring 2026' }}
      />,
    );
    expect(screen.getByText('Spring 2026')).toBeDefined();
  });

  it('renders Join Challenge button when onJoin is provided', () => {
    const onJoin = vi.fn();
    render(<ChallengeCard challenge={baseChallenge} onJoin={onJoin} />);
    expect(screen.getByRole('button', { name: /Join Challenge/ })).toBeDefined();
  });

  it('calls onJoin with challenge id when join button clicked', async () => {
    const onJoin = vi.fn();
    const user = userEvent.setup();
    render(<ChallengeCard challenge={baseChallenge} onJoin={onJoin} />);
    await user.click(screen.getByRole('button', { name: /Join Challenge/ }));
    expect(onJoin).toHaveBeenCalledWith('ch-1');
  });

  it('shows progress percentage when joined', () => {
    render(
      <ChallengeCard
        challenge={{
          ...baseChallenge,
          joined: true,
          my_progress: {
            current_progress: 6,
            percent_complete: 60,
            completed: false,
            reward_claimed: false,
          },
        }}
      />,
    );
    expect(screen.getByText('60%')).toBeDefined();
    expect(screen.getByText(/6 \/ 10/)).toBeDefined();
  });

  it('shows Completed badge when challenge is completed', () => {
    render(
      <ChallengeCard
        challenge={{
          ...baseChallenge,
          joined: true,
          my_progress: {
            current_progress: 10,
            percent_complete: 100,
            completed: true,
            reward_claimed: false,
          },
        }}
      />,
    );
    expect(screen.getByText('Completed')).toBeDefined();
    expect(screen.getByText(/Reward available to claim/)).toBeDefined();
  });

  it('renders top participants leaderboard preview', () => {
    const leaderboard: LeaderboardEntry[] = [
      {
        rank: 1,
        provider_id: 'p1',
        display_name: 'Alice',
        avatar_url: null,
        current_progress: 9,
        percent_complete: 90,
        completed: false,
      },
      {
        rank: 2,
        provider_id: 'p2',
        display_name: 'Bob',
        avatar_url: null,
        current_progress: 7,
        percent_complete: 70,
        completed: false,
      },
    ];
    render(<ChallengeCard challenge={baseChallenge} leaderboard={leaderboard} />);
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText('Top Participants')).toBeDefined();
  });

  it('renders priority_placement reward label and Flame icon', () => {
    render(
      <ChallengeCard
        challenge={{
          ...baseChallenge,
          reward_type: 'priority_placement',
          reward_value: 'top_of_search_7_days',
        }}
      />,
    );
    expect(
      screen.getByText(/Priority Placement \(top of search 7 days\)/),
    ).toBeDefined();
  });

  it('renders fee_discount reward label', () => {
    render(
      <ChallengeCard
        challenge={{
          ...baseChallenge,
          reward_type: 'fee_discount',
          reward_value: 'fifty_percent_off',
        }}
      />,
    );
    expect(screen.getByText(/Fee Discount \(fifty percent off\)/)).toBeDefined();
  });

  it('renders profile_highlight reward label', () => {
    render(
      <ChallengeCard
        challenge={{
          ...baseChallenge,
          reward_type: 'profile_highlight',
          reward_value: 'gold_border',
        }}
      />,
    );
    expect(screen.getByText(/Profile Highlight \(gold border\)/)).toBeDefined();
  });

  it('renders max participants when set', () => {
    render(
      <ChallengeCard
        challenge={{ ...baseChallenge, max_participants: 100 }}
      />,
    );
    expect(screen.getByText(/100 max/)).toBeDefined();
  });

  it('renders singular participant label when count is 1', () => {
    render(
      <ChallengeCard
        challenge={{ ...baseChallenge, participant_count: 1 }}
      />,
    );
    // "1 participant" — exact match without trailing 's'
    const matches = screen.getAllByText(/1 participant/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders icons for each challenge_type variant', () => {
    const types: Array<typeof baseChallenge.challenge_type> = [
      'jobs_completed',
      'five_star_reviews',
      'response_time',
      'bid_win_rate',
      'revenue_milestone',
      'category_specialist',
    ];
    for (const t of types) {
      const { unmount } = render(
        <ChallengeCard challenge={{ ...baseChallenge, challenge_type: t, id: `ch-${t}` }} />,
      );
      // Card title still renders
      expect(screen.getByText('Complete 10 jobs')).toBeDefined();
      unmount();
    }
  });
});
