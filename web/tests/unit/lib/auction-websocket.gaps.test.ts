// auctionWsManager — connecting to the job that is already connected, a
// token that disappears between close and re-dial, successive reconnect
// timing, and unsubscribing listeners.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auctionWsManager } from '@/lib/auction-websocket';

import { FakeWebSocket } from './_gaps-fake-websocket';

const DEBOUNCE_MS = 100;

function connectAndDial(
  jobId: string,
  token: string,
  tokenGetter?: () => string | null,
  tokenRefresher?: () => Promise<boolean>,
): FakeWebSocket {
  auctionWsManager.connect(jobId, token, tokenGetter, tokenRefresher);
  vi.advanceTimersByTime(DEBOUNCE_MS);
  return FakeWebSocket.last();
}

beforeEach(() => {
  vi.useFakeTimers();
  // jitter(d) = d/2 + random * d/2 → with random = 1 the delay is exactly d.
  vi.spyOn(Math, 'random').mockReturnValue(1);
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  auctionWsManager.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('connecting again', () => {
  it('keeps the live socket when asked for the job it is already on', () => {
    const socket = connectAndDial('job-1', 'tok-1');
    socket.open();

    auctionWsManager.connect('job-1', 'tok-2');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.closeCalls).toBe(0);
    expect(auctionWsManager.getStatus()).toBe('connected');
  });

  it('closes the old socket and dials the new job with the new token', () => {
    const first = connectAndDial('job-1', 'tok-1');
    first.open();

    const second = connectAndDial('job-2', 'tok-2');

    expect(first.closeCalls).toBe(1);
    expect(second.url).toMatch(/\/ws\/auction\/job-2$/);
    expect(second.protocols).toEqual(['nomarkup.bearer.v1', 'tok-2']);
    expect(auctionWsManager.getStatus()).toBe('connecting');
  });
});

describe('reconnect', () => {
  it('does not re-dial when the token is gone by the time the backoff elapses (signed out)', async () => {
    let token: string | null = 'tok-1';
    const refresher = vi.fn(() => {
      token = null; // refresh failed and cleared the session
      return Promise.resolve(false);
    });
    connectAndDial('job-1', 'tok-1', () => token, refresher).drop();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(refresher).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(auctionWsManager.getStatus()).toBe('disconnected');
  });

  // A rejecting token refresher: see auction-websocket.refresh-rejection.test.ts.

  it('does not re-dial after disconnect() cancels a pending reconnect', async () => {
    connectAndDial('job-1', 'tok-1', () => 'tok-1').drop();

    auctionWsManager.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // The full delay ladder, the 30s ceiling and the resets are covered in
  // auction-websocket.backoff.test.ts.
  it('doubles the reconnect delay after each failed attempt (1s, 2s, 4s)', async () => {
    connectAndDial('job-1', 'tok-1', () => 'tok-1').drop();

    for (const delay of [1_000, 2_000, 4_000]) {
      const before = FakeWebSocket.instances.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
      FakeWebSocket.last().drop();
    }
  });

  it('stops re-dialing after 10 failed attempts', async () => {
    connectAndDial('job-1', 'tok-1', () => 'tok-1').drop();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const before = FakeWebSocket.instances.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
      FakeWebSocket.last().drop();
    }

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeWebSocket.instances).toHaveLength(11);
    expect(auctionWsManager.getStatus()).toBe('disconnected');
  });
});

describe('listeners', () => {
  it('onStatusChange reports the current status immediately and stops after unsubscribe', () => {
    const listener = vi.fn<(status: string) => void>();
    const off = auctionWsManager.onStatusChange(listener);
    expect(listener.mock.calls).toEqual([['disconnected']]);

    const socket = connectAndDial('job-1', 'tok-1');
    socket.open();
    expect(listener.mock.calls.map((c) => c[0])).toEqual([
      'disconnected',
      'disconnected',
      'connecting',
      'connected',
    ]);

    off();
    auctionWsManager.disconnect();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('onMessage stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const off = auctionWsManager.onMessage(listener);
    const socket = connectAndDial('job-1', 'tok-1');
    socket.open();
    const frame = { type: 'auction_state', job_id: 'job-1' };

    socket.receive(JSON.stringify(frame));
    off();
    socket.receive(JSON.stringify(frame));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(frame);
  });
});
