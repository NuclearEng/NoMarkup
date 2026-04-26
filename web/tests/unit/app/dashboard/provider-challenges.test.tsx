// Smoke + branch tests for the provider challenges page.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/challenges',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/providers/ChallengeCard', () => ({
  ChallengeCard: ({ challenge, onJoin }: { challenge: { id: string; name: string }; onJoin?: (id: string) => void }) =>
    createElement(
      'div',
      { 'data-testid': `challenge-${challenge.id}` },
      challenge.name,
      onJoin
        ? createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                onJoin(challenge.id);
              },
            },
            `Join ${challenge.name}`,
          )
        : null,
    ),
}));

vi.mock('@/hooks/useChallenges', () => ({
  useActiveChallenges: vi.fn(),
  useJoinChallenge: vi.fn(),
  useMyChallenges: vi.fn(),
}));

const { useActiveChallenges, useJoinChallenge, useMyChallenges } = await import(
  '@/hooks/useChallenges'
);
const { default: ProviderChallengesPage } = await import(
  '@/app/(dashboard)/provider/challenges/page'
);

function setHooks(opts: {
  active?: unknown[];
  activeLoading?: boolean;
  mine?: unknown[];
  myLoading?: boolean;
  joinMutate?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(useActiveChallenges).mockReturnValue({
    data: opts.active,
    isLoading: opts.activeLoading ?? false,
  } as unknown as ReturnType<typeof useActiveChallenges>);
  vi.mocked(useMyChallenges).mockReturnValue({
    data: opts.mine,
    isLoading: opts.myLoading ?? false,
  } as unknown as ReturnType<typeof useMyChallenges>);
  vi.mocked(useJoinChallenge).mockReturnValue({
    mutate: opts.joinMutate ?? vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useJoinChallenge>);
}

describe('ProviderChallengesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHooks();
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(container).toBeTruthy();
  });

  it('renders the heading and three tabs', () => {
    render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(screen.getByRole('heading', { name: 'Challenges' })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Available/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /In Progress/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Completed/ })).toBeDefined();
  });

  it('renders the available-tab loading skeletons', () => {
    setHooks({ activeLoading: true });
    const { container } = render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('renders the empty available state', () => {
    setHooks({ active: [] });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(screen.getByText(/No new challenges available right now/)).toBeDefined();
  });

  it('renders available challenges that have not been joined', () => {
    setHooks({
      active: [{ id: 'c1', name: 'First Bid', joined: false }],
    });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(screen.getByTestId('challenge-c1')).toBeDefined();
    expect(screen.getByText('First Bid')).toBeDefined();
  });

  it('shows the seasonal banner when an active seasonal challenge exists', () => {
    setHooks({
      active: [
        { id: 'c1', name: 'Holiday Hustle', is_seasonal: true, season_name: 'Winter Sprint' },
      ],
    });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(screen.getByText('Winter Sprint')).toBeDefined();
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('renders the in-progress tab as a clickable tab control', () => {
    setHooks({ mine: [] });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    const tab = screen.getByRole('tab', { name: /In Progress/ });
    expect(tab).toBeDefined();
    expect(tab.getAttribute('data-state')).toBe('inactive');
  });

  it('shows badge counts on tabs when challenges exist', () => {
    setHooks({
      active: [
        { id: 'c1', name: 'Avail 1', joined: false },
        { id: 'c2', name: 'Avail 2', joined: false },
      ],
      mine: [
        { id: 'c3', name: 'Done', completed: true, current_progress: 1, percent_complete: 100, reward_claimed: false, completed_at: null, joined_at: '2026-01-01T00:00:00Z' },
      ],
    });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    // Numeric badge "2" appears in the Available tab.
    const availableTab = screen.getByRole('tab', { name: /Available/ });
    expect(availableTab.textContent).toContain('2');
  });

  it('renders the Available tab as the default-active tab', () => {
    setHooks({ active: [], mine: [] });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    const tab = screen.getByRole('tab', { name: /Available/ });
    expect(tab.getAttribute('data-state')).toBe('active');
  });

  it('shows the in-progress loading skeletons when myLoading is true', async () => {
    const user = userEvent.setup();
    setHooks({ myLoading: true, mine: [] });
    const { container } = render(withQueryClient(createElement(ProviderChallengesPage)));
    await user.click(screen.getByRole('tab', { name: /In Progress/ }));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('shows the empty in-progress state when there are no in-progress challenges', async () => {
    const user = userEvent.setup();
    setHooks({ active: [], mine: [] });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    await user.click(screen.getByRole('tab', { name: /In Progress/ }));
    expect(
      screen.getByText(/You haven't joined any challenges yet/i),
    ).toBeDefined();
  });

  it('renders in-progress challenges with my_progress mapped through', async () => {
    const user = userEvent.setup();
    setHooks({
      mine: [
        {
          id: 'in-1',
          name: 'Active Quest',
          completed: false,
          current_progress: 5,
          percent_complete: 50,
          reward_claimed: false,
          completed_at: null,
          joined_at: '2026-04-01T00:00:00Z',
        },
      ],
    });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    await user.click(screen.getByRole('tab', { name: /In Progress/ }));
    expect(screen.getByTestId('challenge-in-1')).toBeDefined();
  });

  it('shows the empty completed state when no challenges are done', async () => {
    const user = userEvent.setup();
    setHooks({ active: [], mine: [] });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    await user.click(screen.getByRole('tab', { name: /Completed/ }));
    expect(
      screen.getByText(/No completed challenges yet/i),
    ).toBeDefined();
  });

  it('renders completed challenges through the my_progress mapper', async () => {
    const user = userEvent.setup();
    setHooks({
      mine: [
        {
          id: 'done-1',
          name: 'Finished Quest',
          completed: true,
          current_progress: 10,
          percent_complete: 100,
          reward_claimed: true,
          completed_at: '2026-04-15T00:00:00Z',
          joined_at: '2026-04-01T00:00:00Z',
        },
      ],
    });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    await user.click(screen.getByRole('tab', { name: /Completed/ }));
    expect(screen.getByTestId('challenge-done-1')).toBeDefined();
  });

  it('shows the completed-tab loading skeletons when myLoading is true', async () => {
    const user = userEvent.setup();
    setHooks({ myLoading: true, mine: [] });
    const { container } = render(withQueryClient(createElement(ProviderChallengesPage)));
    await user.click(screen.getByRole('tab', { name: /Completed/ }));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('invokes the join mutation when the available challenge Join button is clicked', () => {
    const mutate = vi.fn();
    setHooks({
      active: [{ id: 'avail-1', name: 'Try Me', joined: false }],
      joinMutate: mutate,
    });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    fireEvent.click(screen.getByRole('button', { name: /Join Try Me/ }));
    expect(mutate).toHaveBeenCalled();
    const args = mutate.mock.calls[0] as unknown[];
    expect(args[0]).toBe('avail-1');
    expect(args[1]).toMatchObject({ onSettled: expect.any(Function) as unknown });
  });

  it('hides the seasonal banner when no seasonal challenge is active', () => {
    setHooks({ active: [{ id: 'c1', name: 'Plain', joined: false, is_seasonal: false }] });
    render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(screen.queryByText('Live')).toBeNull();
  });
});
