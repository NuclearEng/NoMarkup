// Spectator page — heavy client component using a WebSocket terminal hook.
// We mock the hook + terminal sub-components and assert loading, error, and
// success layouts.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/auctions/test-id/spectate',
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

vi.mock('@/hooks/useJobs', () => ({ useJob: vi.fn() }));
vi.mock('@/hooks/useSpectatorTerminal', () => ({
  useSpectatorTerminal: vi.fn(),
}));

const { useJob } = await import('@/hooks/useJobs');
const { useSpectatorTerminal } = await import('@/hooks/useSpectatorTerminal');
const { default: SpectatorPage } = await import('@/app/(public)/auctions/[id]/spectate/page');

function setSpectatorMock(overrides: Partial<{
  sim: object;
  providers: readonly unknown[];
  spectatorCount: number;
  isConnected: boolean;
  error: Error | null;
}> = {}) {
  vi.mocked(useSpectatorTerminal).mockReturnValue({
    sim: {},
    providers: [],
    spectatorCount: 3,
    isConnected: true,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useSpectatorTerminal>);
}

describe('(public)/auctions/[id]/spectate/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSpectatorMock();
  });

  it('shows the loading state', () => {
    vi.mocked(useJob).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useJob>);

    const { container } = render(createElement(SpectatorPage));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows the not-found state on error', () => {
    vi.mocked(useJob).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useJob>);

    render(createElement(SpectatorPage));
    expect(screen.getByRole('heading', { name: 'Auction Not Found' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Browse all jobs/ })).toBeDefined();
  });

  it('renders the terminal shell when a job loads', () => {
    vi.mocked(useJob).mockReturnValue({
      data: {
        id: 'test-id',
        title: 'Roof repair',
        location_address: '123 Main St',
        starting_bid_cents: 50000,
        market_range: null,
        auction_ends_at: null,
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useJob>);

    render(createElement(SpectatorPage));
    expect(screen.getAllByText('Roof repair').length).toBeGreaterThan(0);
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
    expect(screen.getByTestId('terminal-toolbar')).toBeDefined();
    expect(screen.getByText(/3 watching/)).toBeDefined();
  });

  it('renders the disconnected (error) connection chip when the WS errors out', () => {
    vi.mocked(useJob).mockReturnValue({
      data: {
        id: 'test-id',
        title: 'Roof repair',
        location_address: '123 Main St',
        starting_bid_cents: 50000,
        market_range: null,
        auction_ends_at: null,
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useJob>);
    setSpectatorMock({
      isConnected: false,
      error: new Error('WS connection failed'),
      spectatorCount: 0,
    });

    render(createElement(SpectatorPage));
    expect(screen.getByText('Disconnected')).toBeDefined();
    expect(screen.getByLabelText('Connection error')).toBeDefined();
  });

  it('renders the connecting connection chip when not yet connected and no error', () => {
    vi.mocked(useJob).mockReturnValue({
      data: {
        id: 'test-id',
        title: 'Roof repair',
        location_address: null,
        starting_bid_cents: 0,
        market_range: { low_cents: 100, median_cents: 200, high_cents: 300, sample_size: 5 },
        auction_ends_at: '2026-04-26T00:00:00Z',
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useJob>);
    setSpectatorMock({
      isConnected: false,
      error: null,
      spectatorCount: 0,
    });

    render(createElement(SpectatorPage));
    expect(screen.getByText('Connecting')).toBeDefined();
    expect(screen.getByLabelText('Connecting to live stream')).toBeDefined();
    // No spectator count chip when count is 0.
    expect(screen.queryByText(/watching/)).toBeNull();
  });
});
