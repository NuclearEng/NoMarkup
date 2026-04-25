import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuctionReplay } from '@/components/bids/AuctionReplay';
import type { ReplayData } from '@/hooks/useAuctionReplay';

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

vi.mock('@/hooks/useAuctionReplay', () => ({
  useAuctionReplay: vi.fn(),
}));

const { useAuctionReplay } = await import('@/hooks/useAuctionReplay');

const sampleData: ReplayData = {
  events: [
    {
      id: 'e1',
      job_id: 'job-1',
      event_type: 'bid_placed',
      amount_cents: 50000,
      created_at: '2026-03-01T12:00:00Z',
    },
    {
      id: 'e2',
      job_id: 'job-1',
      event_type: 'bid_placed',
      amount_cents: 40000,
      created_at: '2026-03-01T12:00:30Z',
    },
    {
      id: 'e3',
      job_id: 'job-1',
      event_type: 'bid_placed',
      amount_cents: 30000,
      created_at: '2026-03-01T12:01:00Z',
    },
  ],
  job_title: 'Plumbing repair',
  category: 'Plumbing',
  starting_bid_cents: 60000,
  winning_bid_cents: 30000,
  total_savings_cents: 30000,
  duration_seconds: 60,
  bid_count: 3,
};

describe('AuctionReplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the loading skeleton when data is loading', () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    const { container } = render(<AuctionReplay jobId="job-1" />);
    // Skeleton blocks render as divs with .bg-muted
    const skeletons = container.querySelectorAll('.bg-muted');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders the error state when the query errors', () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    render(<AuctionReplay jobId="job-1" />);
    expect(screen.getByText(/failed to load auction replay/i)).toBeDefined();
  });

  it('renders the empty state when there are no events', () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: { ...sampleData, events: [] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    render(<AuctionReplay jobId="job-1" />);
    expect(screen.getByText(/no bid events recorded/i)).toBeDefined();
  });

  it('renders the Auction Replay header and PAUSED state initially', () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: sampleData,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    render(<AuctionReplay jobId="job-1" />);
    expect(screen.getByText('Auction Replay')).toBeDefined();
    expect(screen.getByText('PAUSED')).toBeDefined();
  });

  it('transitions to PLAYING when play is clicked', async () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: sampleData,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    const user = userEvent.setup();
    render(<AuctionReplay jobId="job-1" />);
    await user.click(screen.getByLabelText('Play replay'));
    expect(screen.getByText('PLAYING')).toBeDefined();
  });

  it('toggles back to PAUSED when pause is clicked', async () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: sampleData,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    const user = userEvent.setup();
    render(<AuctionReplay jobId="job-1" />);
    await user.click(screen.getByLabelText('Play replay'));
    await user.click(screen.getByLabelText('Pause replay'));
    expect(screen.getByText('PAUSED')).toBeDefined();
  });

  it('renders speed selector buttons', () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: sampleData,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    render(<AuctionReplay jobId="job-1" />);
    expect(screen.getByRole('radio', { name: '1x' })).toBeDefined();
    expect(screen.getByRole('radio', { name: '5x' })).toBeDefined();
    expect(screen.getByRole('radio', { name: '10x' })).toBeDefined();
  });

  it('changes speed when a different speed button is clicked', async () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: sampleData,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    const user = userEvent.setup();
    render(<AuctionReplay jobId="job-1" />);
    const tenX = screen.getByRole('radio', { name: '10x' });
    await user.click(tenX);
    expect(tenX.getAttribute('aria-checked')).toBe('true');
  });

  it('renders a restart button', () => {
    vi.mocked(useAuctionReplay).mockReturnValue({
      data: sampleData,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuctionReplay>);
    render(<AuctionReplay jobId="job-1" />);
    expect(screen.getByLabelText('Restart replay')).toBeDefined();
  });
});
