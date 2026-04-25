import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChallengeManager } from '@/components/admin/ChallengeManager';
import type { AdminChallenge } from '@/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

const mockCreate = vi.fn();

vi.mock('@/hooks/useChallenges', () => ({
  useAdminChallenges: vi.fn(),
  useCreateChallenge: () => ({ mutate: mockCreate, isPending: false, isError: false }),
}));

const { useAdminChallenges } = await import('@/hooks/useChallenges');

function makeChallenge(overrides: Partial<AdminChallenge> = {}): AdminChallenge {
  return {
    id: 'ch-1',
    title: 'Speed Demon',
    description: 'Win 10 jobs in a week',
    challenge_type: 'jobs_completed',
    target_value: 10,
    reward_type: 'badge',
    reward_value: 'Rising Star',
    starts_at: '2026-04-01T00:00:00Z',
    ends_at: '2026-05-01T00:00:00Z',
    is_seasonal: false,
    season_name: null,
    max_participants: null,
    participant_count: 12,
    completed_count: 3,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

describe('ChallengeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty-state message when there are no challenges', () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    render(createElement(ChallengeManager));
    expect(screen.getByText(/No challenges created yet/i)).toBeDefined();
  });

  it('renders summary metrics and a challenge row', () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [makeChallenge(), makeChallenge({ id: 'ch-2', is_active: false })],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    render(createElement(ChallengeManager));
    // Total Challenges = 2
    expect(screen.getByText('Total Challenges')).toBeDefined();
    // Both rows render with the same title; just confirm at least one renders.
    const titles = screen.getAllByText('Speed Demon');
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Active Now')).toBeDefined();
  });

  it('toggles the new challenge form when New Challenge is clicked', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const user = userEvent.setup();
    render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    expect(screen.getByLabelText(/^title$/i)).toBeDefined();
    expect(screen.getByLabelText(/target value/i)).toBeDefined();
  });
});
