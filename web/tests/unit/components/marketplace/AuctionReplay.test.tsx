// Goods-side auction replay (components/marketplace/AuctionReplay).
// MOCKED: useListingReplay (the query). PROVEN: loading / error / empty
// states, the play → pause → restart → replay state machine, the compressed
// inter-event delays (30x, clamped to 120ms..3000ms, divided by speed), the
// running high-bid / bid-count stats, and scrubbing.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuctionReplay } from '@/components/marketplace/AuctionReplay';
import type { ListingAuctionReplay } from '@/types';

beforeAll(() => {
  // Radix Slider measures its thumb with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

const replayState: {
  data: ListingAuctionReplay | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const requestedIds: string[] = [];

vi.mock('@/hooks/useAuctionReplay', () => ({
  useListingReplay: (listingId: string) => {
    requestedIds.push(listingId);
    return replayState;
  },
}));

// e0 → e1: 60s of auction  → 2000ms of replay at 1x (1000ms at 2x, 500ms at 4x)
// e1 → e2: 1s of auction   → 33ms, clamped UP to the 120ms floor
// e2 → e3: 10min of auction → 20000ms, clamped DOWN to the 3000ms ceiling
const REPLAY: ListingAuctionReplay = {
  listing_id: 'l-1',
  started_at: '2026-03-01T11:00:00.000Z',
  ended_at: '2026-03-01T12:11:01.000Z',
  winner_id: 'u-2',
  events: [
    {
      type: 'bid_placed',
      at: '2026-03-01T12:00:00.000Z',
      amount_cents: 5000,
      anonymized_bidder: 'Bidder A',
    },
    {
      type: 'bid_placed',
      at: '2026-03-01T12:01:00.000Z',
      amount_cents: 6550,
      anonymized_bidder: 'Bidder B',
    },
    {
      type: 'snipe_extension',
      at: '2026-03-01T12:01:01.000Z',
      extended_to: '2026-03-01T12:06:01.000Z',
    },
    {
      // Deliberately LOWER than the standing high bid: the hero price must
      // keep showing the maximum, not the latest event.
      type: 'bid_placed',
      at: '2026-03-01T12:11:01.000Z',
      amount_cents: 6000,
      anonymized_bidder: 'Bidder A',
    },
  ],
};

function setReplay(data: ListingAuctionReplay | undefined) {
  replayState.data = data;
  replayState.isLoading = false;
  replayState.isError = false;
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function statValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? '';
}

function heroPrice(): string {
  return screen.getByRole('status').textContent;
}

function historyRows(): string[] {
  const list = screen.getByRole('list', { name: 'Bid history' });
  return within(list)
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
}

function play() {
  fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
}

beforeEach(() => {
  vi.useFakeTimers();
  requestedIds.length = 0;
  setReplay(REPLAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('marketplace AuctionReplay — query states', () => {
  it('asks for the replay of the listing it was given', () => {
    render(<AuctionReplay listingId="listing-42" />);
    expect(requestedIds).toContain('listing-42');
  });

  it('shows only skeletons while the replay is loading', () => {
    replayState.data = undefined;
    replayState.isLoading = true;
    render(<AuctionReplay listingId="l-1" />);
    expect(screen.queryByRole('button', { name: 'Play replay' })).toBeNull();
    expect(screen.queryByText(/failed to load auction replay/i)).toBeNull();
    expect(screen.queryByText('Auction Replay')).toBeNull();
  });

  it('explains the failure when the query errors', () => {
    replayState.data = undefined;
    replayState.isError = true;
    render(<AuctionReplay listingId="l-1" />);
    expect(screen.getByText(/failed to load auction replay/i)).toBeInTheDocument();
    expect(screen.getByText(/may still be live/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play replay' })).toBeNull();
  });

  it('shows the same failure copy when the query settles without data', () => {
    setReplay(undefined);
    render(<AuctionReplay listingId="l-1" />);
    expect(screen.getByText(/failed to load auction replay/i)).toBeInTheDocument();
  });

  it('shows an empty state, with no player controls, when nobody bid', () => {
    setReplay({ ...REPLAY, events: [] });
    render(<AuctionReplay listingId="l-1" />);
    expect(screen.getByText('No bid events recorded for this auction.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play replay' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });
});

describe('marketplace AuctionReplay — playback', () => {
  it('starts paused with nothing revealed', () => {
    render(<AuctionReplay listingId="l-1" />);
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(heroPrice()).toBe('No bids yet');
    expect(screen.getByText('Current high bid')).toBeInTheDocument();
    expect(statValue('Bids')).toBe('0');
    expect(statValue('Speed')).toBe('1x');
    expect(statValue('Events')).toBe('0 / 4');
    expect(historyRows()).toEqual([]);
    expect(screen.queryByText('Auction complete')).toBeNull();
  });

  it('reveals the first bid as soon as Play is pressed', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    expect(screen.getByText('PLAYING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument();
    expect(heroPrice()).toBe('$50.00');
    expect(statValue('Bids')).toBe('1');
    expect(statValue('Events')).toBe('1 / 4');
    expect(historyRows()).toEqual(['bid placedBidder A · $50.00']);
  });

  it('waits the 30x-compressed gap before the next bid lands', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    // 60s of auction = 2000ms of replay. Not there yet at 1999ms.
    advance(1999);
    expect(heroPrice()).toBe('$50.00');
    advance(1);
    expect(heroPrice()).toBe('$65.50');
    expect(statValue('Bids')).toBe('2');
    expect(statValue('Events')).toBe('2 / 4');
  });

  it('holds a near-instant gap open for the 120ms floor', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    // 1s of auction would be 33ms; the floor keeps the event visible.
    advance(119);
    expect(statValue('Events')).toBe('2 / 4');
    advance(1);
    expect(statValue('Events')).toBe('3 / 4');
  });

  it('lists a snipe extension without a bidder or amount and does not count it as a bid', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    advance(120);
    expect(historyRows()).toEqual([
      'bid placedBidder A · $50.00',
      'bid placedBidder B · $65.50',
      'snipe extension',
    ]);
    expect(statValue('Bids')).toBe('2');
    expect(heroPrice()).toBe('$65.50');
  });

  it('caps a long quiet stretch at 3000ms and keeps the highest bid as the hero price', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    advance(120);
    // 10 minutes of auction would be 20s of replay; capped at 3s.
    advance(2999);
    expect(statValue('Events')).toBe('3 / 4');
    advance(1);
    expect(statValue('Events')).toBe('4 / 4');
    expect(statValue('Bids')).toBe('3');
    // The last bid ($60.00) is below the standing high bid ($65.50).
    expect(heroPrice()).toBe('$65.50');
  });

  it('marks the replay complete after the last event', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    advance(120);
    advance(3000);
    expect(screen.getByText('COMPLETE')).toBeInTheDocument();
    expect(screen.getByText('Final winning bid')).toBeInTheDocument();
    expect(screen.getByText('Auction complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play replay' })).toBeInTheDocument();
  });

  it('plays again from the first bid when Play is pressed after completion', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    advance(120);
    advance(3000);
    play();
    expect(screen.getByText('PLAYING')).toBeInTheDocument();
    expect(screen.queryByText('Auction complete')).toBeNull();
    expect(statValue('Events')).toBe('1 / 4');
    expect(heroPrice()).toBe('$50.00');
    advance(2000);
    expect(statValue('Events')).toBe('2 / 4');
  });

  it('completes immediately when the auction had a single bid', () => {
    const only = REPLAY.events[0];
    if (!only) throw new Error('fixture needs an event');
    setReplay({ ...REPLAY, events: [only] });
    render(<AuctionReplay listingId="l-1" />);
    play();
    expect(screen.getByText('COMPLETE')).toBeInTheDocument();
    expect(statValue('Events')).toBe('1 / 1');
    expect(heroPrice()).toBe('$50.00');
    expect(screen.getByText('Auction complete')).toBeInTheDocument();
  });
});

describe('marketplace AuctionReplay — pause, restart, speed', () => {
  it('stops revealing events while paused and resumes from the same place', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    advance(10_000);
    expect(statValue('Events')).toBe('1 / 4');

    play();
    expect(statValue('Events')).toBe('1 / 4');
    advance(2000);
    expect(statValue('Events')).toBe('2 / 4');
  });

  it('Restart clears everything revealed so far and stops playback', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    fireEvent.click(screen.getByRole('button', { name: 'Restart replay' }));
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(heroPrice()).toBe('No bids yet');
    expect(statValue('Events')).toBe('0 / 4');
    expect(historyRows()).toEqual([]);
    advance(10_000);
    expect(statValue('Events')).toBe('0 / 4');
  });

  it('Restart after completion removes the completion banner', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    advance(120);
    advance(3000);
    fireEvent.click(screen.getByRole('button', { name: 'Restart replay' }));
    expect(screen.queryByText('Auction complete')).toBeNull();
    expect(screen.getByText('Current high bid')).toBeInTheDocument();
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
  });

  it('offers 1x / 2x / 4x and marks only the chosen speed as checked', () => {
    render(<AuctionReplay listingId="l-1" />);
    const group = screen.getByRole('radiogroup', { name: 'Playback speed' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['1x', '2x', '4x']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

    fireEvent.click(within(group).getByRole('radio', { name: '4x' }));
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-checked')),
    ).toEqual(['false', 'false', 'true']);
    expect(statValue('Speed')).toBe('4x');
  });

  it('divides the wait by the chosen speed', () => {
    render(<AuctionReplay listingId="l-1" />);
    fireEvent.click(screen.getByRole('radio', { name: '4x' }));
    play();
    // 2000ms at 1x becomes 500ms at 4x.
    advance(499);
    expect(statValue('Events')).toBe('1 / 4');
    advance(1);
    expect(statValue('Events')).toBe('2 / 4');
  });

  // Pausing right after a speed change: see AuctionReplay.timers.test.tsx.

  it('does not go faster than the 120ms floor even at 4x', () => {
    render(<AuctionReplay listingId="l-1" />);
    fireEvent.click(screen.getByRole('radio', { name: '4x' }));
    play();
    advance(500);
    advance(119);
    expect(statValue('Events')).toBe('2 / 4');
    advance(1);
    expect(statValue('Events')).toBe('3 / 4');
  });
});

describe('marketplace AuctionReplay — scrubbing', () => {
  it('jumps to the end of the auction and pauses there', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    const thumb = screen.getByRole('slider', { name: 'Scrub through auction replay' });
    fireEvent.keyDown(thumb, { key: 'End' });
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(statValue('Events')).toBe('4 / 4');
    expect(statValue('Bids')).toBe('3');
    expect(heroPrice()).toBe('$65.50');
    // Scrubbing to the end is not the same as watching it finish.
    expect(screen.queryByText('Auction complete')).toBeNull();
    advance(10_000);
    expect(statValue('Events')).toBe('4 / 4');
  });

  it('steps one event at a time and back to the first event', () => {
    render(<AuctionReplay listingId="l-1" />);
    const thumb = screen.getByRole('slider', { name: 'Scrub through auction replay' });
    expect(thumb).toHaveAttribute('aria-valuenow', '0');

    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(statValue('Events')).toBe('2 / 4');
    expect(heroPrice()).toBe('$65.50');

    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(statValue('Events')).toBe('3 / 4');

    fireEvent.keyDown(thumb, { key: 'Home' });
    expect(statValue('Events')).toBe('1 / 4');
    expect(heroPrice()).toBe('$50.00');
  });

  it('clears the completion state when the viewer scrubs back', () => {
    render(<AuctionReplay listingId="l-1" />);
    play();
    advance(2000);
    advance(120);
    advance(3000);
    expect(screen.getByText('Auction complete')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' });
    expect(screen.queryByText('Auction complete')).toBeNull();
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(statValue('Events')).toBe('1 / 4');
  });

  it('resumes from the scrubbed position', () => {
    render(<AuctionReplay listingId="l-1" />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    play();
    advance(3000);
    expect(statValue('Events')).toBe('4 / 4');
    expect(screen.getByText('COMPLETE')).toBeInTheDocument();
  });
});
