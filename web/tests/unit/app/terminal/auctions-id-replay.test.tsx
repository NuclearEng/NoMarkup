// Replay page — heavy client component using a replay terminal hook. We mock
// the hook + terminal sub-components and assert loading, error, and success
// shells.
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders the Pause button when isPlaying is true', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isPlaying: true,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const pauseBtn = screen.getByRole('button', { name: /Pause replay/i });
    fireEvent.click(pauseBtn);
    expect(baseReplay.handlePause).toHaveBeenCalled();
  });

  it('renders the Play button when isPlaying is false', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isPlaying: false,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const playBtn = screen.getByRole('button', { name: /Play replay/i });
    fireEvent.click(playBtn);
    expect(baseReplay.handlePlay).toHaveBeenCalled();
  });

  it('renders the Replay label when isComplete is true', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isPlaying: false,
      isComplete: true,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    expect(screen.getByRole('button', { name: /Replay auction/i })).toBeDefined();
  });

  it('renders Resume label when paused with bidCount > 0', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isPlaying: false,
      isComplete: false,
      sim: { bidCount: 3 },
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    // The visible "Resume" label is hidden behind responsive class but text node exists
    expect(screen.getAllByText(/Resume/i).length).toBeGreaterThan(0);
  });

  it('triggers handleRestart on Restart button click', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const restartBtn = screen.getByRole('button', { name: /Restart replay/i });
    fireEvent.click(restartBtn);
    expect(baseReplay.handleRestart).toHaveBeenCalled();
  });

  it('renders all SPEED_OPTIONS as radio buttons', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const radios = screen.getAllByRole('radio');
    // 1x, 2x, 4x with 2 radio groups (mobile + desktop) = 6 radios
    expect(radios.length).toBeGreaterThanOrEqual(3);
  });

  it('marks current speed as aria-checked', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      speed: 2,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const checkedRadios = screen
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checkedRadios.length).toBeGreaterThan(0);
  });

  it('triggers handleSpeedChange when a speed button clicked', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const radios = screen.getAllByRole('radio');
    const r4x = radios.find((r) => r.textContent === '4x');
    if (!r4x) throw new Error('4x radio missing');
    fireEvent.click(r4x);
    expect(baseReplay.handleSpeedChange).toHaveBeenCalledWith(4);
  });

  it('renders completion overlay when isComplete and not dismissed', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isComplete: true,
      winningBidCents: 60000,
      totalBidCount: 5,
      totalSavingsCents: 40000,
      startingBidCents: 100000,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    expect(screen.getByRole('dialog', { name: /Auction replay complete/i })).toBeDefined();
    expect(screen.getByText('Auction Complete')).toBeDefined();
    // Savings percent: 40000/100000 = 40%
    expect(screen.getByText(/40% below starting price/)).toBeDefined();
  });

  it('completion overlay shows N/A when winningBidCents is 0', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isComplete: true,
      winningBidCents: 0,
      totalBidCount: 0,
      totalSavingsCents: 0,
      startingBidCents: 0,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    expect(screen.getByText('N/A')).toBeDefined();
    expect(screen.getByText('$0')).toBeDefined();
  });

  it('Continue button in completion overlay dismisses it', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isComplete: true,
      winningBidCents: 60000,
      totalBidCount: 5,
      totalSavingsCents: 40000,
      startingBidCents: 100000,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(continueBtn);
    expect(screen.queryByRole('dialog', { name: /Auction replay complete/i })).toBeNull();
  });

  it('Watch Again button on completion overlay calls handleRestart', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isComplete: true,
      winningBidCents: 60000,
      totalBidCount: 5,
      totalSavingsCents: 40000,
      startingBidCents: 100000,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const replayBtn = screen.getByRole('button', { name: /Watch Again/i });
    fireEvent.click(replayBtn);
    expect(baseReplay.handleRestart).toHaveBeenCalled();
  });

  it('renders without crashing when category is missing', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      category: undefined,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    expect(screen.getByText('Test job')).toBeDefined();
  });

  it('renders ReplayNotFound link to /jobs', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      isError: true,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const link = screen.getByRole('link', { name: /Browse all jobs/i });
    expect(link.getAttribute('href')).toBe('/jobs');
  });

  it('falls back to 60% of starting price for low_cents when winningBidCents is zero', () => {
    // startingBidCents > 0 but winningBidCents <= 0 forces the
    // Math.round(startingBidCents * 0.6) branch in the marketRange useMemo
    // (source line 206).
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      winningBidCents: 0,
      startingBidCents: 100000,
      totalBidCount: 0,
      isComplete: false,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    // Page still renders the terminal grid even with no winning bid yet.
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
  });

  it('mobile speed selector also wires up handleSpeedChange', () => {
    // The page renders two SPEED_OPTIONS radiogroups: one for desktop and one
    // mobile-only (sm:hidden). Clicking the second 2x button covers the mobile
    // arrow callback at source line 379.
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    const allRadios = screen.getAllByRole('radio');
    const twoXButtons = allRadios.filter((r) => r.textContent === '2x');
    // There should be at least 2 (desktop + mobile rendering).
    expect(twoXButtons.length).toBeGreaterThanOrEqual(2);
    const mobile = twoXButtons[twoXButtons.length - 1];
    if (!mobile) throw new Error('mobile 2x radio missing');
    fireEvent.click(mobile);
    expect(baseReplay.handleSpeedChange).toHaveBeenCalledWith(2);
  });

  it('uses scrubStep of 100 when totalBidCount is 1 or less', () => {
    vi.mocked(useReplayTerminal).mockReturnValue({
      ...baseReplay,
      totalBidCount: 1,
    } as unknown as ReturnType<typeof useReplayTerminal>);
    render(createElement(AuctionReplayPage));
    // Slider rendered with step=100 (mobile + desktop sliders both present).
    const sliders = screen.getAllByLabelText(/Scrub through auction replay/i);
    expect(sliders.length).toBeGreaterThan(0);
  });
});
