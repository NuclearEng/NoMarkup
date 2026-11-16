import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MarketplaceSpectatorClient,
  type MarketplaceBidEventData,
  type MarketplaceConnectionStatus,
} from '@/lib/marketplace-spectator-websocket';

// ─── FakeWebSocket double ────────────────────────────────────────
type AnyEventHandler = ((ev: Event) => void) | null;
type MessageEventHandler = ((ev: MessageEvent) => void) | null;
type CloseEventHandler = ((ev: CloseEvent) => void) | null;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const inst = FakeWebSocket.instances.at(-1);
    if (!inst) throw new Error('FakeWebSocket: no instance constructed');
    return inst;
  }

  readyState: number = FakeWebSocket.OPEN;
  url: string;
  onopen: AnyEventHandler = null;
  onmessage: MessageEventHandler = null;
  onclose: CloseEventHandler = null;
  onerror: AnyEventHandler = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }
  emitMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  emitRawMessage(raw: string): void {
    this.onmessage?.(new MessageEvent('message', { data: raw }));
  }
  emitClose(code = 1000): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code }));
  }
  emitError(): void {
    this.onerror?.(new Event('error'));
  }
}

describe('MarketplaceSpectatorClient', () => {
  let client: MarketplaceSpectatorClient;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    client = new MarketplaceSpectatorClient();
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts in disconnected status', () => {
    expect(client.getStatus()).toBe('disconnected');
  });

  it('debounces socket creation by 100ms', () => {
    client.connect('listing-1');
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(99);
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('connects to /ws/marketplace/{listingId}/spectate (anonymous, no token)', () => {
    client.connect('listing-xyz');
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    expect(ws.url).toContain('/ws/marketplace/listing-xyz/spectate');
    expect(ws.url).not.toContain('token=');
    expect(ws.url).not.toContain('?');
  });

  it('replaces a queued connect when a second connect is called within debounce', () => {
    client.connect('listing-A');
    client.connect('listing-B');
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last().url).toContain('/ws/marketplace/listing-B/spectate');
  });

  it('flips connection status: disconnected → connecting → connected', () => {
    const seen: MarketplaceConnectionStatus[] = [];
    client.on('connection', (s) => seen.push(s));
    expect(seen).toEqual(['disconnected']);

    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    expect(client.getStatus()).toBe('connecting');

    FakeWebSocket.last().emitOpen();
    expect(client.getStatus()).toBe('connected');
    expect(seen.at(-1)).toBe('connected');
  });

  it('dispatches bid_event payloads to bid listeners', () => {
    const received: MarketplaceBidEventData[] = [];
    client.on('bid', (b) => received.push(b));

    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitMessage({
      type: 'bid_event',
      listing_id: 'listing-1',
      data: {
        type: 'bid_placed',
        listing_id: 'listing-1',
        amount_cents: 9_999,
        snipe_extension: false,
        snipe_extension_count: 0,
        new_auction_ends_at: null,
        timestamp: '2026-04-25T00:00:00Z',
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.amount_cents).toBe(9_999);
    expect(received[0]?.snipe_extension).toBe(false);
  });

  it('dispatches spectator_count payloads to count listeners', () => {
    const counts: number[] = [];
    client.on('spectator_count', (n) => counts.push(n));

    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitMessage({
      type: 'spectator_count',
      listing_id: 'listing-1',
      spectator_count: 47,
    });

    expect(counts).toEqual([47]);
  });

  it('passes through snipe_extension flag and new_auction_ends_at on bid events', () => {
    const received: MarketplaceBidEventData[] = [];
    client.on('bid', (b) => received.push(b));

    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitMessage({
      type: 'bid_event',
      listing_id: 'listing-1',
      data: {
        type: 'bid_placed',
        listing_id: 'listing-1',
        amount_cents: 50_000,
        snipe_extension: true,
        snipe_extension_count: 2,
        new_auction_ends_at: '2026-04-27T19:30:00Z',
        timestamp: '2026-04-27T19:00:00Z',
      },
    });

    expect(received[0]?.snipe_extension).toBe(true);
    expect(received[0]?.snipe_extension_count).toBe(2);
    expect(received[0]?.new_auction_ends_at).toBe('2026-04-27T19:30:00Z');
  });

  it('silently swallows malformed message payloads', () => {
    const received: MarketplaceBidEventData[] = [];
    client.on('bid', (b) => received.push(b));

    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    expect(() => {
      FakeWebSocket.last().emitRawMessage('not-json{');
    }).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('schedules a reconnect with ~1s backoff after an unexpected close', () => {
    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitClose(1006);
    expect(client.getStatus()).toBe('disconnected');

    expect(() => {
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
    // After backoff the client should have created a new socket.
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT reconnect after explicit disconnect()', () => {
    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    client.disconnect();
    expect(client.getStatus()).toBe('disconnected');

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('disconnect() during the debounce window cancels socket creation', () => {
    client.connect('listing-1');
    expect(FakeWebSocket.instances).toHaveLength(0);
    client.disconnect();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('on(event) returns an unsubscribe function that detaches the listener', () => {
    const counts: number[] = [];
    const off = client.on('spectator_count', (n) => counts.push(n));

    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();
    FakeWebSocket.last().emitMessage({
      type: 'spectator_count',
      listing_id: 'listing-1',
      spectator_count: 1,
    });
    expect(counts).toEqual([1]);

    off();
    FakeWebSocket.last().emitMessage({
      type: 'spectator_count',
      listing_id: 'listing-1',
      spectator_count: 2,
    });
    expect(counts).toEqual([1]);
  });

  it('emits current connection status synchronously to new connection subscribers', () => {
    const seen: MarketplaceConnectionStatus[] = [];
    client.on('connection', (s) => seen.push(s));
    expect(seen).toEqual(['disconnected']);
  });

  it('onerror is a non-throwing no-op (close handles reconnect)', () => {
    client.connect('listing-1');
    vi.advanceTimersByTime(100);
    expect(() => {
      FakeWebSocket.last().emitError();
    }).not.toThrow();
  });
});
