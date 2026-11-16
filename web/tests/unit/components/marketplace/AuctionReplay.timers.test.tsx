// AuctionReplay — one pending step at a time. Changing speed mid-playback used
// to leave the previous timer running; Pause cleared only the newest, and the
// orphan still revealed an event while the player said PAUSED.
import { act, fireEvent, render, screen } from '@testing-library/react';
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

// Each gap is 60s of auction: 2000ms of replay at 1x, 500ms at 4x.
const REPLAY: ListingAuctionReplay = {
  listing_id: 'l-1',
  started_at: '2026-03-01T11:00:00.000Z',
  ended_at: '2026-03-01T12:02:00.000Z',
  winner_id: 'u-2',
  events: [
    { type: 'bid_placed', at: '2026-03-01T12:00:00.000Z', amount_cents: 5000, anonymized_bidder: 'Bidder A' },
    { type: 'bid_placed', at: '2026-03-01T12:01:00.000Z', amount_cents: 6000, anonymized_bidder: 'Bidder B' },
    { type: 'bid_placed', at: '2026-03-01T12:02:00.000Z', amount_cents: 7000, anonymized_bidder: 'Bidder A' },
  ],
};

vi.mock('@/hooks/useAuctionReplay', () => ({
  useListingReplay: () => ({ data: REPLAY, isLoading: false, isError: false }),
}));

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function eventsShown(): string {
  return screen.getByText('Events').nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AuctionReplay timers', () => {
  it('stays on the current event when paused right after a speed change', () => {
    render(<AuctionReplay listingId="l-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
    expect(eventsShown()).toBe('1 / 3');

    fireEvent.click(screen.getByRole('radio', { name: '4x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    advance(5000);

    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(eventsShown()).toBe('1 / 3');
  });

  it('a speed change mid-step reveals the next event once, at the new speed', () => {
    render(<AuctionReplay listingId="l-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
    advance(100);
    fireEvent.click(screen.getByRole('radio', { name: '4x' }));

    advance(499);
    expect(eventsShown()).toBe('1 / 3');
    advance(1);
    expect(eventsShown()).toBe('2 / 3');
    // The old 1x timer (due at 2000ms) must not fire a second reveal early.
    advance(499);
    expect(eventsShown()).toBe('2 / 3');
    advance(1);
    expect(eventsShown()).toBe('3 / 3');
  });

  it('leaves no timer pending after unmount', () => {
    const view = render(<AuctionReplay listingId="l-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
    fireEvent.click(screen.getByRole('radio', { name: '2x' }));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
