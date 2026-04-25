// Replay page — heavy client component using a replay terminal hook. We mock
// the hook + terminal sub-components and assert loading, error, and success
// shells.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';

beforeAll(() => {
  // Radix Slider observes its container size — jsdom has no ResizeObserver.
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/auctions/test-id/replay',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'test-id' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const stub = (testid: string) => () => createElement('div', { 'data-testid': testid });

vi.mock('@/components/landing/GradientMesh', () => ({ GradientMesh: stub('mesh') }));
vi.mock('@/components/terminal/terminal-toolbar', () => ({
  TerminalToolbar: stub('terminal-toolbar'),
}));
vi.mock('@/components/terminal/terminal-grid', () => ({
  TerminalGrid: stub('terminal-grid'),
}));

const baseReplay = {
  isLoading: false,
  isError: false,
  isPlaying: false,
  isComplete: false,
  jobTitle: 'Test job',
  category: 'Plumbing',
  speed: 1,
  scrubValue: 0,
  elapsedLabel: '0:00',
  totalLabel: '0:00',
  totalBidCount: 5,
  startingBidCents: 100000,
  winningBidCents: 60000,
  totalSavingsCents: 40000,
  sim: { bidCount: 0 },
  mockProviders: [],
  handlePlay: vi.fn(),
  handlePause: vi.fn(),
  handleRestart: vi.fn(),
  handleScrub: vi.fn(),
  handleSpeedChange: vi.fn(),
};

vi.mock('@/hooks/useReplayTerminal', () => ({
  useReplayTerminal: vi.fn(),
  SPEED_OPTIONS: [1, 2, 4],
}));

const { useReplayTerminal } = await import('@/hooks/useReplayTerminal');
const { default: AuctionReplayPage } = await import(
  '@/app/(terminal)/auctions/[id]/replay/page'
);

describe('(terminal)/auctions/[id]/replay/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the loading skeleton', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isLoading: true,
    } as unknown as ReturnType<typeof useReplayTerminal>);

    const { container } = render(createElement(AuctionReplayPage));
    // Skeleton component renders bg-white/5/10 utility skeletons
    expect(container.querySelector('[class*="rounded"]')).not.toBeNull();
  });

  it('renders the not-found fallback on error', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isError: true,
    } as unknown as ReturnType<typeof useReplayTerminal>);

    render(createElement(AuctionReplayPage));
    expect(screen.getByRole('heading', { name: 'Replay Not Available' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Browse all jobs/ })).toBeDefined();
  });

  it('renders the terminal shell when replay loads', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
    } as unknown as ReturnType<typeof useReplayTerminal>);

    render(createElement(AuctionReplayPage));
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
    expect(screen.getByTestId('terminal-toolbar')).toBeDefined();
    expect(screen.getByText('Test job')).toBeDefined();
    expect(screen.getByText('Replay')).toBeDefined();
  });
});
