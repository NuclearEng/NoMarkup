// MarketplaceSpectatorClient — reconnect backoff growth, the 10-attempt cap,
// the reset after a stable connection, a constructor that throws, frames
// that must be ignored, re-connecting to the listing already open, and the
// spectator_count / connection unsubscribe functions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceSpectatorClient } from '@/lib/marketplace-spectator-websocket';

import { FakeWebSocket } from './_gaps-fake-websocket';

const DEBOUNCE_MS = 100;

let client: MarketplaceSpectatorClient;

function connectAndDial(listingId: string): FakeWebSocket {
  client.connect(listingId);
  vi.advanceTimersByTime(DEBOUNCE_MS);
  return FakeWebSocket.last();
}

beforeEach(() => {
  vi.useFakeTimers();
  // jitter(d) = d/2 + random * d/2 → with random = 1 the delay is exactly d.
  vi.spyOn(Math, 'random').mockReturnValue(1);
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  client = new MarketplaceSpectatorClient();
});

afterEach(() => {
  client.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reconnect backoff', () => {
  it('doubles the delay after each failed attempt: 1s, 2s, 4s', () => {
    connectAndDial('l-1').drop();

    for (const delay of [1_000, 2_000, 4_000]) {
      const before = FakeWebSocket.instances.length;
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
      FakeWebSocket.last().drop();
    }
  });

  it('gives up after 10 reconnect attempts', () => {
    connectAndDial('l-1').drop();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      vi.advanceTimersByTime(30_000);
      FakeWebSocket.last().drop();
    }
    // 1 initial dial + 10 re-dials.
    expect(FakeWebSocket.instances).toHaveLength(11);

    vi.advanceTimersByTime(10 * 60_000);
    expect(FakeWebSocket.instances).toHaveLength(11);
    expect(client.getStatus()).toBe('disconnected');
  });

  it('starts over at 1s after a connection that stayed up for 5s', () => {
    connectAndDial('l-1').drop();
    vi.advanceTimersByTime(1_000);
    FakeWebSocket.last().drop();
    vi.advanceTimersByTime(2_000);
    // Third socket: next delay would be 4s — unless the connection proves stable.
    const stable = FakeWebSocket.last();
    stable.open();
    vi.advanceTimersByTime(5_000);
    stable.drop();

    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  });

  it('keeps growing the delay when the connection opens but drops within 5s (flapping)', () => {
    connectAndDial('l-1').drop();
    vi.advanceTimersByTime(1_000);
    const flapping = FakeWebSocket.last();
    flapping.open();
    vi.advanceTimersByTime(4_999);
    flapping.drop();

    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1_999);
    expect(FakeWebSocket.instances).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  });

  it('reports disconnected and retries when the WebSocket constructor throws', () => {
    const statuses: string[] = [];
    client.on('connection', (status) => {
      statuses.push(status);
    });
    FakeWebSocket.failNextConstruction = new Error('SecurityError: insecure ws:// from https page');

    client.connect('l-1');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(statuses).toEqual(['disconnected', 'connecting', 'disconnected']);

    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last().url).toMatch(/\/ws\/marketplace\/l-1\/spectate$/);
  });
});

describe('connecting again', () => {
  it('keeps the existing socket when asked for the listing that is already open', () => {
    const socket = connectAndDial('l-1');
    socket.open();

    client.connect('l-1');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.closeCalls).toBe(0);
    expect(client.getStatus()).toBe('connected');
  });

  it('closes the old socket and dials the new listing', () => {
    const first = connectAndDial('l-1');
    first.open();

    const second = connectAndDial('l-2');

    expect(first.closeCalls).toBe(1);
    expect(second).not.toBe(first);
    expect(second.url).toMatch(/\/ws\/marketplace\/l-2\/spectate$/);
    // The replaced socket's late close must not trigger a re-dial of l-1.
    first.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('re-dials the same listing when its socket has already closed', () => {
    const socket = connectAndDial('l-1');
    socket.readyState = FakeWebSocket.CLOSED;

    client.connect('l-1');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe('frames that are ignored', () => {
  it('delivers nothing for binary frames, unknown types, or incomplete payloads', () => {
    const onBid = vi.fn();
    const onCount = vi.fn();
    client.on('bid', onBid);
    client.on('spectator_count', onCount);
    const socket = connectAndDial('l-1');
    socket.open();

    socket.receive(new ArrayBuffer(8));
    socket.receive(JSON.stringify({ type: 'heartbeat', listing_id: 'l-1' }));
    socket.receive(JSON.stringify({ type: 'bid_event', listing_id: 'l-1' }));
    socket.receive(JSON.stringify({ type: 'spectator_count', listing_id: 'l-1', spectator_count: '12' }));
    socket.receive(JSON.stringify({ type: 'spectator_count', listing_id: 'l-1' }));

    expect(onBid).not.toHaveBeenCalled();
    expect(onCount).not.toHaveBeenCalled();

    socket.receive(JSON.stringify({ type: 'spectator_count', listing_id: 'l-1', spectator_count: 0 }));
    expect(onCount).toHaveBeenCalledWith(0);
  });
});

describe('unsubscribing', () => {
  it('stops bid callbacks for the unsubscribed listener only', () => {
    const onBid = vi.fn();
    const otherBid = vi.fn();
    const offBid = client.on('bid', onBid);
    client.on('bid', otherBid);
    const socket = connectAndDial('l-1');
    socket.open();
    const bid = { type: 'bid_placed', listing_id: 'l-1', amount_cents: 5_000 };

    socket.receive(JSON.stringify({ type: 'bid_event', listing_id: 'l-1', data: bid }));
    offBid();
    socket.receive(JSON.stringify({ type: 'bid_event', listing_id: 'l-1', data: bid }));

    expect(onBid).toHaveBeenCalledTimes(1);
    expect(onBid).toHaveBeenCalledWith(bid);
    expect(otherBid).toHaveBeenCalledTimes(2);
  });

  it('stops spectator_count and connection callbacks, leaving other listeners attached', () => {
    const onCount = vi.fn();
    const otherCount = vi.fn();
    const onConnection = vi.fn();
    const offCount = client.on('spectator_count', onCount);
    client.on('spectator_count', otherCount);
    const offConnection = client.on('connection', onConnection);
    expect(onConnection).toHaveBeenCalledTimes(1);
    expect(onConnection).toHaveBeenCalledWith('disconnected');

    offCount();
    offConnection();
    const socket = connectAndDial('l-1');
    socket.open();
    socket.receive(JSON.stringify({ type: 'spectator_count', listing_id: 'l-1', spectator_count: 4 }));

    expect(onCount).not.toHaveBeenCalled();
    expect(otherCount).toHaveBeenCalledWith(4);
    expect(onConnection).toHaveBeenCalledTimes(1);
  });
});
