// Branch coverage for JobDetailClient beyond jobs-id.test.tsx: the pre-bid
// "Ask a question" channel flow (inquiry vs. bid channel, navigation, every
// failure toast, pending state) on both layouts, the owner repost two-step
// confirm, instant-match pending, singular copy, the live spectator count, the
// LiveBidTicker price/timer inputs, and case-insensitive self-block guards.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bid, BidWithProvider, JobDetail, JobLiquidity } from '@/types';

const routerPush = vi.hoisted(() => vi.fn<(href: string) => void>());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const toastError = vi.hoisted(() => vi.fn<(message: string) => void>());
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError },
}));

const stub = (testid: string) => () => createElement('div', { 'data-testid': testid });

interface TickerProps {
  currentBid: number;
  startingPrice: number;
  totalBids: number;
  timeRemaining?: string;
}
const tickerProps: TickerProps[] = [];
vi.mock('@/components/bids/LiveBidTicker', () => ({
  LiveBidTicker: (props: TickerProps) => {
    tickerProps.push(props);
    return createElement('div', { 'data-testid': 'live-bid-ticker' });
  },
}));

vi.mock('@/components/bids/BidActivityFeed', () => ({ BidActivityFeed: stub('bid-activity') }));
vi.mock('@/components/bids/BidForm', () => ({ BidForm: stub('bid-form') }));
vi.mock('@/components/bids/BidList', () => ({ BidList: stub('bid-list') }));
vi.mock('@/components/bids/BidPriceChart', () => ({ BidPriceChart: stub('bid-price-chart') }));
vi.mock('@/components/chat/ReportButton', () => ({ ReportButton: stub('report-button') }));
vi.mock('@/components/chat/BlockButton', () => ({
  BlockButton: ({ userId }: { userId: string }) =>
    createElement('button', { type: 'button', 'data-testid': 'block-user' }, userId),
}));
vi.mock('@/components/chat/ChatRelayAlias', () => ({ ChatRelayAlias: () => null }));
vi.mock('@/components/landing/GradientMesh', () => ({ GradientMesh: stub('mesh') }));
vi.mock('@/components/jobs/AuctionTimer', () => ({ AuctionTimer: stub('auction-timer') }));
vi.mock('@/components/jobs/BidPushPrompt', () => ({ BidPushPrompt: stub('push-prompt') }));
vi.mock('@/components/jobs/MarketRangeDisplay', () => ({ MarketRangeDisplay: stub('market-range') }));
vi.mock('@/components/jobs/PermitIntelligenceBanner', () => ({
  PermitIntelligenceBanner: stub('permit'),
}));
vi.mock('@/components/jobs/SavingsBadge', () => ({ SavingsBadge: stub('savings-badge') }));
vi.mock('@/components/jobs/ReportJobButton', () => ({ ReportJobButton: stub('report-job') }));
vi.mock('@/components/jobs/ViewerCount', () => ({ ViewerCount: stub('viewer-count') }));
vi.mock('@/components/jobs/JobAnswers', () => ({ JobAnswers: stub('job-answers') }));
vi.mock('@/components/terminal/terminal-toolbar', () => ({ TerminalToolbar: stub('terminal-toolbar') }));
vi.mock('@/components/terminal/terminal-grid', () => ({ TerminalGrid: stub('terminal-grid') }));

vi.mock('@/lib/constants', () => ({
  ENABLE_LIVE_AUCTION: true,
  BUYER_PAYS_AGREED_PRICE: 'You pay the agreed price.',
}));

interface TestUser {
  id: string;
  roles: string[];
}

interface ChannelInput {
  job_id: string;
  channel_type: string;
}

interface RepostOptions {
  onSuccess: (created: { id: string }) => void;
}

/** Everything the mocked hooks hand the component, reset before each test. */
const h = vi.hoisted(() => ({
  job: undefined as unknown,
  user: null as unknown,
  isAuthenticated: false,
  bids: [] as unknown[],
  bidCount: undefined as number | undefined,
  countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
  spectator: { isConnected: true, spectatorCount: 0 },
  channelPending: false,
  instantMatchPending: false,
  repostPending: false,
  createChannel: vi.fn<(input: ChannelInput) => Promise<{ id: string }>>(),
  instantMatch: vi.fn<() => void>(),
  repost: vi.fn<(id: string, options: RepostOptions) => void>(),
  terminalJobIds: { participant: [] as (string | undefined)[], spectator: [] as (string | undefined)[] },
}));

vi.mock('@/hooks/useJobs', () => ({
  useJob: () => ({ data: h.job, isError: false, refetch: vi.fn() }),
  useRepostJob: () => ({ mutate: h.repost, isPending: h.repostPending }),
}));
vi.mock('@/hooks/useBids', () => ({
  useBidCount: () => ({ data: h.bidCount }),
  useBidsForJob: () => ({ data: { bids: h.bids } }),
}));
vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => h.countdown,
}));
vi.mock('@/hooks/useChannels', () => ({
  useCreateChannel: () => ({ mutateAsync: h.createChannel, isPending: h.channelPending }),
}));
vi.mock('@/hooks/useInstantMatch', () => ({
  useCreateInstantMatch: () => ({ mutate: h.instantMatch, isPending: h.instantMatchPending }),
}));
vi.mock('@/hooks/useAuctionTerminal', () => ({
  useAuctionTerminal: (jobId: string | undefined) => {
    h.terminalJobIds.participant.push(jobId);
    return { sim: {}, providers: [], isConnected: true, error: null, snipeExtensionCount: 0 };
  },
}));
vi.mock('@/hooks/useSpectatorTerminal', () => ({
  useSpectatorTerminal: (jobId: string | undefined) => {
    h.terminalJobIds.spectator.push(jobId);
    return {
      sim: {},
      providers: [],
      isConnected: h.spectator.isConnected,
      error: null,
      spectatorCount: h.spectator.spectatorCount,
    };
  },
}));
vi.mock('@/hooks/useTerminalHotkeys', () => ({
  useTerminalHotkeys: vi.fn(),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { user: unknown; isAuthenticated: boolean }) => unknown) =>
    selector({ user: h.user, isAuthenticated: h.isAuthenticated }),
}));

// Dynamic import: the mock factories above close over module-level helpers
// (`stub`, `tickerProps`), which must be initialised before the island loads.
const { JobDetailClient } = await import('@/app/(public)/jobs/[id]/JobDetailClient');

function makeJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 'job-1',
    customer_id: 'cust-1',
    category_id: 'cat-1',
    category_name: 'Plumbing',
    category_slug: 'plumbing',
    title: 'Replace water heater',
    description: 'Need a new tankless unit',
    status: 'active',
    schedule_type: 'flexible',
    scheduled_date: null,
    is_recurring: false,
    recurrence_frequency: null,
    location_address: null,
    location_lat: null,
    location_lng: null,
    starting_bid_cents: null,
    offer_accepted_cents: null,
    auction_duration_hours: 24,
    auction_ends_at: null,
    bid_count: 0,
    lowest_bid_cents: null,
    market_range: null,
    auction_type: 'sealed',
    snipe_extension_count: 0,
    original_auction_ends_at: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    customer_display_name: 'Sam Customer',
    customer_avatar_url: null,
    customer_member_since: '2024-01-01T00:00:00Z',
    customer_jobs_posted: 1,
    ...overrides,
  };
}

function makeBid(providerId: string): BidWithProvider {
  const bid: Bid = {
    id: `bid-${providerId}`,
    job_id: 'job-1',
    provider_id: providerId,
    amount_cents: 9000,
    is_offer_accepted: false,
    status: 'active',
    original_amount_cents: 9000,
    bid_history: [],
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
    awarded_at: null,
    withdrawn_at: null,
  };
  return { bid, provider_display_name: 'Pat', provider_business_name: 'Pat LLC' } as BidWithProvider;
}

const OWNER: TestUser = { id: 'cust-1', roles: ['customer'] };
const PROVIDER: TestUser = { id: 'prov-1', roles: ['provider'] };

function signIn(user: TestUser): void {
  h.user = user;
  h.isAuthenticated = true;
}

function renderClient(job: JobDetail) {
  h.job = job;
  return render(<JobDetailClient jobId="job-1" initialJob={job} />);
}

function askButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Ask a question' });
}

function lastTicker(): TickerProps {
  const props = tickerProps.at(-1);
  if (!props) throw new Error('LiveBidTicker was not rendered');
  return props;
}

beforeEach(() => {
  h.job = undefined;
  h.user = null;
  h.isAuthenticated = false;
  h.bids = [];
  h.bidCount = undefined;
  h.countdown = { timeLeft: '1h', isExpired: false, totalSeconds: 3600 };
  h.spectator = { isConnected: true, spectatorCount: 0 };
  h.channelPending = false;
  h.instantMatchPending = false;
  h.repostPending = false;
  h.createChannel.mockReset();
  h.createChannel.mockResolvedValue({ id: 'chan-1' });
  h.instantMatch.mockReset();
  h.repost.mockReset();
  h.terminalJobIds.participant.length = 0;
  h.terminalJobIds.spectator.length = 0;
  tickerProps.length = 0;
  routerPush.mockReset();
  toastError.mockReset();
});

describe('JobDetailClient — Ask a question (sealed layout)', () => {
  it('opens an inquiry channel for a provider with no bid and navigates to it', async () => {
    signIn(PROVIDER);
    h.createChannel.mockResolvedValue({ id: 'chan/1 a' });
    renderClient(makeJob());

    fireEvent.click(askButton());

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/messages?channel=chan%2F1%20a');
    });
    expect(h.createChannel).toHaveBeenCalledTimes(1);
    expect(h.createChannel).toHaveBeenCalledWith({ job_id: 'job-1', channel_type: 'inquiry' });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens the bid channel when the provider already has a bid on the job', async () => {
    signIn(PROVIDER);
    h.bids = [makeBid('someone-else'), makeBid('prov-1')];
    renderClient(makeJob());

    fireEvent.click(askButton());

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/messages?channel=chan-1');
    });
    expect(h.createChannel).toHaveBeenCalledWith({ job_id: 'job-1', channel_type: 'bid' });
  });

  it('toasts and does not navigate when the API returns a channel without an id', async () => {
    signIn(PROVIDER);
    h.createChannel.mockResolvedValue({ id: '' });
    renderClient(makeJob());

    fireEvent.click(askButton());

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Could not open chat — no channel returned.');
    });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('toasts the server message when creating the channel fails', async () => {
    signIn(PROVIDER);
    h.createChannel.mockRejectedValue(new Error('You are blocked by this customer'));
    renderClient(makeJob());

    fireEvent.click(askButton());

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('You are blocked by this customer');
    });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('toasts the generic fallback when the failure carries no message', async () => {
    signIn(PROVIDER);
    h.createChannel.mockRejectedValue('nope');
    renderClient(makeJob());

    fireEvent.click(askButton());

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Could not open chat');
    });
  });

  it('disables the button and shows "Opening chat…" while the channel is being created', () => {
    signIn(PROVIDER);
    h.channelPending = true;
    renderClient(makeJob());

    const button = askButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Opening chat…');
    fireEvent.click(button);
    expect(h.createChannel).not.toHaveBeenCalled();
  });

  it.each<[string, TestUser | null, Partial<JobDetail>]>([
    ['a guest', null, {}],
    ['the job owner (even with a provider role)', { id: 'cust-1', roles: ['customer', 'provider'] }, {}],
    ['a customer who is not a provider', { id: 'other', roles: ['customer'] }, {}],
    ['a provider on a closed job', PROVIDER, { status: 'closed' }],
  ])('offers no Ask a question button to %s', (_label, user, overrides) => {
    if (user) signIn(user);
    renderClient(makeJob(overrides));
    expect(screen.queryByRole('button', { name: 'Ask a question' })).toBeNull();
  });
});

describe('JobDetailClient — Ask a question (live dock)', () => {
  const liveJob = makeJob({ auction_type: 'live', starting_bid_cents: 20000 });

  it('opens an inquiry channel from the live dock and navigates to it', async () => {
    signIn(PROVIDER);
    renderClient(liveJob);
    // The dock sits under the terminal, next to the dock BidForm.
    expect(screen.getByTestId('terminal-grid')).toBeInTheDocument();
    expect(screen.getByTestId('bid-form')).toBeInTheDocument();

    fireEvent.click(askButton());

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/messages?channel=chan-1');
    });
    expect(h.createChannel).toHaveBeenCalledWith({ job_id: 'job-1', channel_type: 'inquiry' });
  });

  it('shows the pending state in the live dock', () => {
    signIn(PROVIDER);
    h.channelPending = true;
    renderClient(liveJob);
    const button = askButton();
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Opening chat…');
  });

  it('has no dock question button for the owner watching their own live auction', () => {
    signIn(OWNER);
    renderClient(liveJob);
    expect(screen.getByTestId('terminal-grid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask a question' })).toBeNull();
  });
});

describe('JobDetailClient — live auction feed selection', () => {
  const liveJob = makeJob({ auction_type: 'live', starting_bid_cents: 20000 });

  it('puts a guest on the spectator stream and shows the watcher count', () => {
    h.spectator = { isConnected: true, spectatorCount: 5 };
    renderClient(liveJob);
    expect(screen.getByText('5 watching')).toBeInTheDocument();
    expect(h.terminalJobIds.spectator.at(-1)).toBe('job-1');
    expect(h.terminalJobIds.participant.at(-1)).toBeUndefined();
  });

  it.each<[string, { isConnected: boolean; spectatorCount: number }]>([
    ['nobody is watching', { isConnected: true, spectatorCount: 0 }],
    ['the spectator stream is not connected', { isConnected: false, spectatorCount: 5 }],
  ])('hides the watcher count when %s', (_label, spectator) => {
    h.spectator = spectator;
    renderClient(liveJob);
    expect(screen.queryByText(/watching$/)).toBeNull();
  });

  it('puts the owner on the participant stream and never shows a watcher count', () => {
    signIn(OWNER);
    h.spectator = { isConnected: true, spectatorCount: 5 };
    renderClient(liveJob);
    expect(h.terminalJobIds.participant.at(-1)).toBe('job-1');
    expect(h.terminalJobIds.spectator.at(-1)).toBeUndefined();
    expect(screen.queryByText('5 watching')).toBeNull();
  });

  it('puts a provider with a bid on the participant stream, one without on the spectator stream', () => {
    signIn(PROVIDER);
    h.bids = [makeBid('prov-1')];
    const { unmount } = renderClient(liveJob);
    expect(h.terminalJobIds.participant.at(-1)).toBe('job-1');
    unmount();

    h.bids = [];
    renderClient(liveJob);
    expect(h.terminalJobIds.participant.at(-1)).toBeUndefined();
    expect(h.terminalJobIds.spectator.at(-1)).toBe('job-1');
  });

  it('shows the owner liquidity line in the live header', () => {
    signIn(OWNER);
    const liquidity: JobLiquidity = {
      notified_count: 4,
      first_bid_at: '2026-04-01T00:07:00Z',
      minutes_to_first_bid: 7,
      bid_count: 1,
    };
    renderClient({ ...liveJob, liquidity });
    expect(screen.getByTestId('job-liquidity-live')).toHaveTextContent(
      '4 providers notified — first bid in 7 min',
    );
  });
});

describe('JobDetailClient — owner liquidity copy', () => {
  it('uses the singular for exactly one notified provider', () => {
    signIn(OWNER);
    const liquidity: JobLiquidity = { notified_count: 1, first_bid_at: null, bid_count: 0 };
    renderClient(makeJob({ liquidity }));
    expect(screen.getByTestId('job-liquidity')).toHaveTextContent(
      '1 provider notified — waiting for the first bid',
    );
    expect(screen.getByTestId('job-liquidity-sidebar')).toHaveTextContent(
      '1 provider notified — waiting for the first bid',
    );
  });

  it('still reports a bid that arrived with nobody notified', () => {
    signIn(OWNER);
    const liquidity: JobLiquidity = {
      notified_count: 0,
      first_bid_at: '2026-04-01T00:03:00Z',
      minutes_to_first_bid: 3,
      bid_count: 1,
    };
    renderClient(makeJob({ liquidity }));
    expect(screen.getByTestId('job-liquidity')).toHaveTextContent(
      '0 providers notified — first bid in 3 min',
    );
  });
});

describe('JobDetailClient — bid count copy and ticker inputs', () => {
  it('uses the singular for exactly one bid, preferring the live count over the job seed', () => {
    h.bidCount = 1;
    renderClient(makeJob({ bid_count: 9 }));
    expect(screen.getByText('1 bid placed')).toBeInTheDocument();
    expect(screen.getByText('1 bid')).toBeInTheDocument();
  });

  it('falls back to the job seed count and pluralises it', () => {
    renderClient(makeJob({ bid_count: 3 }));
    expect(screen.getByText('3 bids placed')).toBeInTheDocument();
    expect(screen.getByText('3 bids')).toBeInTheDocument();
  });

  it('shows the starting bid as the ticker price until a bid lands', () => {
    h.bidCount = 0;
    renderClient(makeJob({ starting_bid_cents: 20000 }));
    expect(lastTicker()).toEqual({
      currentBid: 20000,
      startingPrice: 20000,
      totalBids: 0,
      timeRemaining: '1h',
    });
  });

  it('shows the lowest bid as the ticker price once there is one', () => {
    h.bidCount = 2;
    renderClient(makeJob({ starting_bid_cents: 20000, lowest_bid_cents: 15000 }));
    expect(lastTicker()).toMatchObject({ currentBid: 15000, startingPrice: 20000, totalBids: 2 });
  });

  it('drops the countdown from the ticker once the auction has expired', () => {
    h.countdown = { timeLeft: '0s', isExpired: true, totalSeconds: 0 };
    renderClient(makeJob({ starting_bid_cents: 20000 }));
    expect(lastTicker().timeRemaining).toBeUndefined();
  });

  it('renders no ticker for a job without a starting bid', () => {
    renderClient(makeJob({ starting_bid_cents: null }));
    expect(screen.queryByTestId('live-bid-ticker')).toBeNull();
  });
});

describe('JobDetailClient — owner instant match', () => {
  it('quotes the accept price and fires the mutation once', () => {
    signIn(OWNER);
    renderClient(makeJob({ offer_accepted_cents: 15000 }));
    expect(screen.getByText(/Sends an Instant offer at your Accept price/)).toHaveTextContent(
      '($150.00)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Request Instant match' }));
    expect(h.instantMatch).toHaveBeenCalledTimes(1);
  });

  it('disables the CTA and shows progress while the request is pending', () => {
    signIn(OWNER);
    h.instantMatchPending = true;
    renderClient(makeJob({ offer_accepted_cents: 15000 }));
    const button = screen.getByRole('button', { name: 'Requesting instant match…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(h.instantMatch).not.toHaveBeenCalled();
  });

  it('is not offered on a closed job even with an accept price', () => {
    signIn(OWNER);
    renderClient(makeJob({ status: 'closed', offer_accepted_cents: 15000 }));
    expect(screen.queryByRole('button', { name: 'Request Instant match' })).toBeNull();
  });
});

describe('JobDetailClient — owner repost', () => {
  it.each(['closed', 'closed_zero_bids', 'expired', 'cancelled'] as const)(
    'offers Repost to the owner of a %s job',
    (status) => {
      signIn(OWNER);
      renderClient(makeJob({ status }));
      expect(screen.getByTestId('job-repost')).toHaveTextContent('Repost job');
    },
  );

  it.each(['active', 'awarded', 'completed'] as const)(
    'does not offer Repost on a %s job',
    (status) => {
      signIn(OWNER);
      renderClient(makeJob({ status }));
      expect(screen.queryByTestId('job-repost')).toBeNull();
    },
  );

  it('does not offer Repost to a non-owner', () => {
    signIn(PROVIDER);
    renderClient(makeJob({ status: 'expired' }));
    expect(screen.queryByTestId('job-repost')).toBeNull();
  });

  it('asks for confirmation on the first click and reposts only on the second', () => {
    signIn(OWNER);
    renderClient(makeJob({ status: 'expired' }));
    const button = screen.getByTestId('job-repost');

    fireEvent.click(button);
    expect(h.repost).not.toHaveBeenCalled();
    expect(button).toHaveTextContent('Confirm repost');

    fireEvent.click(button);
    expect(h.repost).toHaveBeenCalledTimes(1);
    expect(h.repost.mock.calls[0]?.[0]).toBe('job-1');
  });

  it('navigates to the new job after a successful repost', () => {
    signIn(OWNER);
    renderClient(makeJob({ status: 'cancelled' }));
    const button = screen.getByTestId('job-repost');
    fireEvent.click(button);
    fireEvent.click(button);

    const options = h.repost.mock.calls[0]?.[1];
    if (!options) throw new Error('repost was not called with options');
    expect(routerPush).not.toHaveBeenCalled();
    options.onSuccess({ id: 'job-2' });
    expect(routerPush).toHaveBeenCalledWith('/jobs/job-2');
  });

  it('stays on the page when the repost response carries no id', () => {
    signIn(OWNER);
    renderClient(makeJob({ status: 'cancelled' }));
    const button = screen.getByTestId('job-repost');
    fireEvent.click(button);
    fireEvent.click(button);

    const options = h.repost.mock.calls[0]?.[1];
    if (!options) throw new Error('repost was not called with options');
    options.onSuccess({ id: '' });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('disables the button and shows "Reposting…" while the repost is pending', () => {
    signIn(OWNER);
    h.repostPending = true;
    renderClient(makeJob({ status: 'expired' }));
    const button = screen.getByTestId('job-repost');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Reposting…');
  });
});

describe('JobDetailClient — block targets', () => {
  it('never offers to block yourself when your id differs from the poster id only by case', () => {
    // Not the owner by strict equality, so the party actions render — but the
    // case-insensitive guard must still refuse to target the viewer.
    signIn({ id: 'CUST-1', roles: ['customer'] });
    renderClient(makeJob());
    expect(screen.queryByTestId('block-user')).toBeNull();
    expect(screen.getByTestId('report-job')).toBeInTheDocument();
    expect(screen.getByTestId('report-button')).toBeInTheDocument();
  });

  it('offers a signed-out visitor Report-job only for a job with a blank poster id', () => {
    renderClient(makeJob({ customer_id: '   ' }));
    expect(screen.getByTestId('report-job')).toBeInTheDocument();
    expect(screen.queryByTestId('block-user')).toBeNull();
    expect(screen.queryByTestId('report-button')).toBeNull();
  });

  it.each<[string, string | null]>([
    ['there is no awarded provider', null],
    ['the awarded provider id is blank', '  '],
    ['the awarded provider is the owner (case-insensitive)', 'CUST-1'],
  ])('shows the owner no Block button when %s', (_label, awardedProviderId) => {
    signIn(OWNER);
    renderClient(makeJob({ status: 'awarded', awarded_provider_id: awardedProviderId }));
    expect(screen.queryByTestId('block-user')).toBeNull();
  });

  it('lets the owner block the awarded provider from the live layout too, with a trimmed id', () => {
    signIn(OWNER);
    renderClient(
      makeJob({ auction_type: 'live', starting_bid_cents: 20000, awarded_provider_id: ' prov-9 ' }),
    );
    const terminal = screen.getByTestId('terminal-grid');
    expect(terminal).toBeInTheDocument();
    expect(within(document.body).getByTestId('block-user')).toHaveTextContent(/^prov-9$/);
  });
});
