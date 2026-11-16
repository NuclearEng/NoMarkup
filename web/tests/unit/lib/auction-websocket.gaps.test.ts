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

  // Source bug (auction-websocket.ts:182-190): the re-dial is chained with
  // `void refresh.finally(...)`, so a tokenRefresher that rejects re-dials
  // correctly but leaves an unhandled promise rejection behind.
  it.todo('re-dials after a rejecting token refresher without an unhandled rejection');

  it('does not re-dial after disconnect() cancels a pending reconnect', async () => {
    connectAndDial('job-1', 'tok-1', () => 'tok-1').drop();

    auctionWsManager.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // Source bug (auction-websocket.ts:71 → 136): every re-dial goes through
  // doConnect(), which calls disconnect(), which zeroes `reconnectAttempts`.
  // The exponential backoff and the 10-attempt cap therefore never engage.
  it.todo('doubles the reconnect delay after each failed attempt (1s, 2s, 4s)');
  it.todo('stops re-dialing after 10 failed attempts');

  it('currently re-dials ~1s after every drop, with no growth', async () => {
    connectAndDial('job-1', 'tok-1', () => 'tok-1').drop();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const before = FakeWebSocket.instances.length;
      await vi.advanceTimersByTimeAsync(999);
      expect(FakeWebSocket.instances).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
      FakeWebSocket.last().drop();
    }
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
