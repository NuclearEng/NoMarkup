// useReplayTerminal — playback timing and edge cases that
// useReplayTerminal.test.ts does not pin: the per-event delay (real gap scaled
// by speed, clamped to [100ms, 3000ms]), pausing mid-flight, resuming from a
// scrubbed position, running to completion, timer cleanup on unmount, events
// that share an id, and a first event without an id.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplayData } from '@/hooks/useAuctionReplay';
import { useReplayTerminal } from '@/hooks/useReplayTerminal';

const replayMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuctionReplay', () => ({
  useAuctionReplay: replayMock,
}));

const T0 = Date.parse('2026-04-25T00:00:00Z');

/** Build a replay whose events sit at the given millisecond offsets from T0. */
function replayAt(offsetsMs: number[], ids?: string[]): ReplayData {
  return {
    job_title: 'Fence repair',
    category: 'handyman',
    starting_bid_cents: 100_000,
    winning_bid_cents: 50_000,
    total_savings_cents: 50_000,
    duration_seconds: 125,
    bid_count: offsetsMs.length,
    events: offsetsMs.map((offset, i) => ({
      id: ids?.[i] ?? `ev-${String(i)}`,
      job_id: 'job-1',
      event_type: 'bid_placed',
      amount_cents: 90_000 - i * 1000,
      created_at: new Date(T0 + offset).toISOString(),
    })),
  };
}

function mount(data: ReplayData) {
  replayMock.mockReturnValue({ data, isLoading: false, isError: false });
  return renderHook(() => useReplayTerminal('job-1'));
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useReplayTerminal playback timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replayMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scales each gap by the speed and clamps it to 100ms..3000ms, then completes', () => {
    // Gaps: 200ms, 5000ms, 60000ms. At the default 5x: 40 → clamped up to 100,
    // 1000 (unclamped), 12000 → clamped down to 3000.
    const { result } = mount(replayAt([0, 200, 5200, 65_200]));

    act(() => {
      result.current.handlePlay();
    });
    expect(result.current.sim.bidCount).toBe(1);

    advance(99);
    expect(result.current.sim.bidCount).toBe(1);
    advance(1);
    expect(result.current.sim.bidCount).toBe(2);

    advance(999);
    expect(result.current.sim.bidCount).toBe(2);
    advance(1);
    expect(result.current.sim.bidCount).toBe(3);

    advance(2999);
    expect(result.current.sim.bidCount).toBe(3);
    expect(result.current.isComplete).toBe(false);
    advance(1);

    // The last event is on screen: playback stops and the celebration shows.
    expect(result.current.sim.bidCount).toBe(4);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.sim.isRunning).toBe(false);
    expect(result.current.sim.showCelebration).toBe(true);
    expect(result.current.scrubValue).toBe(100);
    expect(result.current.elapsedLabel).toBe('1:05');
    expect(result.current.totalLabel).toBe('2:05');
  });

  it.each([
    { speed: 1, delay: 3000 },
    { speed: 2, delay: 2500 },
    { speed: 5, delay: 1000 },
    { speed: 10, delay: 500 },
  ] as const)('a 5s gap plays back after $delay ms at $speed x', ({ speed, delay }) => {
    const { result } = mount(replayAt([0, 5000, 10_000]));

    act(() => {
      result.current.handleSpeedChange(speed);
    });
    act(() => {
      result.current.handlePlay();
    });

    advance(delay - 1);
    expect(result.current.sim.bidCount).toBe(1);
    advance(1);
    expect(result.current.sim.bidCount).toBe(2);
  });

  it('pausing cancels the pending event; play resumes from where it stopped', () => {
    const { result } = mount(replayAt([0, 5000, 10_000]));

    act(() => {
      result.current.handlePlay();
    });
    advance(500);
    act(() => {
      result.current.handlePause();
    });

    advance(60_000);
    expect(result.current.sim.bidCount).toBe(1);
    expect(result.current.isPlaying).toBe(false);

    act(() => {
      result.current.handlePlay();
    });
    // Resuming keeps the cursor (no jump back to the first event) and waits a
    // full scaled gap again.
    expect(result.current.sim.bidCount).toBe(1);
    advance(1000);
    expect(result.current.sim.bidCount).toBe(2);
  });

  it('plays on from a scrubbed position instead of restarting', () => {
    const { result } = mount(replayAt([0, 5000, 10_000, 15_000]));

    act(() => {
      result.current.handleScrub([67]);
    });
    expect(result.current.sim.bidCount).toBe(3);
    expect(result.current.isPlaying).toBe(false);

    act(() => {
      result.current.handlePlay();
    });
    expect(result.current.sim.bidCount).toBe(3);
    // Scrubbing does not flash the rows it reveals.
    expect(result.current.sim.bids.every((b) => !b.is_new)).toBe(true);

    advance(1000);
    expect(result.current.sim.bidCount).toBe(4);
    expect(result.current.sim.bids[3]?.is_new).toBe(true);
    expect(result.current.isComplete).toBe(true);
  });

  it('scrubbing away from the end clears the completed state and the celebration', () => {
    const { result } = mount(replayAt([0, 5000]));

    act(() => {
      result.current.handlePlay();
    });
    advance(1000);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.sim.showCelebration).toBe(true);

    act(() => {
      result.current.handleScrub([0]);
    });

    expect(result.current.isComplete).toBe(false);
    expect(result.current.sim.showCelebration).toBe(false);
    expect(result.current.sim.bidCount).toBe(1);
    expect(result.current.elapsedLabel).toBe('0:00');
  });

  it('restart forgets the previous lowest bid as well as the cursor', () => {
    const { result } = mount(replayAt([0, 5000, 10_000]));

    act(() => {
      result.current.handlePlay();
    });
    advance(1000);
    expect(result.current.sim.currentLowest).toBe(89_000);
    // The lowest before this event is what the price widget animates from.
    expect(result.current.sim.previousLowest).toBe(90_000);

    act(() => {
      result.current.handleRestart();
    });

    expect(result.current.sim.currentLowest).toBe(0);
    expect(result.current.sim.previousLowest).toBeUndefined();
    expect(result.current.sim.bidCount).toBe(0);
    expect(result.current.elapsedLabel).toBe('0:00');
    advance(60_000);
    expect(result.current.sim.bidCount).toBe(0);
  });

  it('cancels the scheduled event and flash timers on unmount', () => {
    const { result, unmount } = mount(replayAt([0, 5000, 10_000]));

    act(() => {
      result.current.handlePlay();
    });
    // One flash-clear timer for the first event + the next-event timer.
    expect(vi.getTimerCount()).toBe(2);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmounting before playback has nothing to cancel', () => {
    const { unmount } = mount(replayAt([0, 5000]));
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useReplayTerminal event edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replayMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives events that share an id the same anonymous provider', () => {
    const { result } = mount(replayAt([0, 1000, 2000], ['dup', 'dup', 'solo']));

    act(() => {
      result.current.handleScrub([100]);
    });

    expect(result.current.sim.bids.map((b) => b.providerIdx)).toEqual([0, 0, 1]);
    // Two distinct ids → two generated providers, not three.
    expect(result.current.mockProviders.map((p) => p.name)).toEqual([
      'Provider Alpha',
      'Provider Bravo',
    ]);
    expect(result.current.sim.orderBookBids.map((b) => b.provider_name)).toEqual([
      'Provider Bravo',
      'Provider Alpha',
      'Provider Alpha',
    ]);
  });

  it('cycles provider names, trust scores and tiers past the end of each list', () => {
    const { result } = mount(replayAt(Array.from({ length: 13 }, (_, i) => i * 1000)));

    const providers = result.current.mockProviders;
    expect(providers).toHaveLength(13);
    expect(providers[0]).toEqual({ name: 'Provider Alpha', trust: 88, tier: 'trusted', initial: 'PA' });
    // Index 12 wraps the 12 names; index 6 wraps the 6 trust scores/tiers.
    expect(providers[12]).toEqual({ name: 'Provider Alpha', trust: 88, tier: 'trusted', initial: 'PA' });
    expect(providers[6]).toEqual({ name: 'Provider Golf', trust: 88, tier: 'trusted', initial: 'PG' });
    expect(providers[2]).toEqual({ name: 'Provider Charlie', trust: 76, tier: 'rising', initial: 'PC' });
  });

  it('offers eight placeholder providers before any replay has loaded', () => {
    replayMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { result } = renderHook(() => useReplayTerminal('job-1'));

    expect(result.current.mockProviders).toHaveLength(8);
    expect(replayMock).toHaveBeenCalledWith('job-1');
  });

  it('does not flash (or schedule a flash timer for) a first event without an id', () => {
    const { result } = mount(replayAt([0, 5000], ['', 'ev-1']));

    act(() => {
      result.current.handlePlay();
    });

    expect(result.current.sim.bids).toHaveLength(1);
    expect(result.current.sim.bids[0]?.is_new).toBe(false);
    // Only the next-event timer is pending — no flash-clear timer.
    expect(vi.getTimerCount()).toBe(1);

    advance(1000);
    expect(result.current.isComplete).toBe(true);

    // Replaying from the completed state takes the same no-flash path.
    advance(2000);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      result.current.handlePlay();
    });
    expect(result.current.isComplete).toBe(false);
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.sim.bids).toHaveLength(1);
    expect(result.current.sim.bids[0]?.is_new).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('counts velocity over the last 15s of replay time and groups equal bids in one depth bucket', () => {
    const data = replayAt([0, 50_000, 64_000, 65_000]);
    const [, second, third] = data.events;
    if (!second || !third) throw new Error('fixture needs four events');
    third.amount_cents = second.amount_cents;
    const { result } = mount(data);

    act(() => {
      result.current.handleScrub([100]);
    });

    // Latest event is at 65s: 50s, 64s and 65s fall inside the 15s window.
    expect(result.current.sim.velocity).toBe(3);
    expect(result.current.sim.depthBuckets).toEqual([
      { amount_cents: 87_000, count: 1 },
      { amount_cents: 89_000, count: 2 },
      { amount_cents: 90_000, count: 1 },
    ]);
    expect(result.current.sim.activities.map((a) => a.isLowest)).toEqual([true, false, false, false]);
  });

  it.todo(
    'BUG useReplayTerminal.ts:323-327 — changing speed while playing schedules a second timer without cancelling the first; the stale timer later rewinds the cursor (and fires after pause)',
  );
});
