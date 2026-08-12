import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AuctionConnectionStatus,
  type AuctionMessage,
  auctionWsManager,
} from '@/lib/auction-websocket';

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
  protocols: string[];
  onopen: AnyEventHandler = null;
  onmessage: MessageEventHandler = null;
  onclose: CloseEventHandler = null;
  onerror: AnyEventHandler = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
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

describe('auctionWsManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    auctionWsManager.disconnect();
  });

  afterEach(() => {
    auctionWsManager.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts disconnected', () => {
    expect(auctionWsManager.getStatus()).toBe('disconnected');
  });

  it('connect() debounces socket creation by 100ms', () => {
    auctionWsManager.connect('job-1', 'tok');
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(99);
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('dials /ws/auction/{jobId} without a query token and offers bearer + jwt protocols', () => {
    auctionWsManager.connect('job-abc', 'tok with space&plus');
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    expect(ws.url).toContain('/ws/auction/job-abc');
    expect(ws.url).not.toContain('token=');
    expect(ws.protocols).toEqual(['nomarkup.bearer.v1', 'tok with space&plus']);
  });

  it('emits status transitions: connecting → connected on open', () => {
    const seen: AuctionConnectionStatus[] = [];
    const off = auctionWsManager.onStatusChange((s) => seen.push(s));
    // onStatusChange immediately fires with current status.
    expect(seen).toEqual(['disconnected']);

    auctionWsManager.connect('job-1', 'tok');
    vi.advanceTimersByTime(100);
    expect(auctionWsManager.getStatus()).toBe('connecting');

    FakeWebSocket.last().emitOpen();
    expect(auctionWsManager.getStatus()).toBe('connected');
    // doConnect calls disconnect() internally first, which fires an extra
    // 'disconnected' before going to connecting/connected.
    expect(seen).toContain('connecting');
    expect(seen.at(-1)).toBe('connected');
    off();
  });

  it('parses and dispatches bid_event messages to listeners', () => {
    const received: AuctionMessage[] = [];
    auctionWsManager.onMessage((m) => received.push(m));

    auctionWsManager.connect('job-1', 'tok');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    const bidEvent: AuctionMessage = {
      type: 'bid_event',
      job_id: 'job-1',
      data: { type: 'bid_placed', job_id: 'job-1', amount_cents: 12_500, timestamp: '2025-01-01T00:00:00Z' },
    };
    FakeWebSocket.last().emitMessage(bidEvent);

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('bid_event');
    expect(received[0]?.data?.amount_cents).toBe(12_500);
  });

  it('dispatches snipe_extended (anti-snipe) and auction_state events', () => {
    const received: AuctionMessage[] = [];
    auctionWsManager.onMessage((m) => received.push(m));

    auctionWsManager.connect('job-1', 'tok');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitMessage({ type: 'snipe_extended', job_id: 'job-1' });
    FakeWebSocket.last().emitMessage({ type: 'auction_state', job_id: 'job-1' });

    expect(received.map((m) => m.type)).toEqual(['snipe_extended', 'auction_state']);
  });

  it('silently swallows malformed messages', () => {
    const received: AuctionMessage[] = [];
    auctionWsManager.onMessage((m) => received.push(m));

    auctionWsManager.connect('job-1', 'tok');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    expect(() => {
      FakeWebSocket.last().emitRawMessage('{not-json');
    }).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('stops reconnecting once the auction_ended event is seen', () => {
    const tokenGetter = vi.fn(() => 'tok');
    auctionWsManager.connect('job-1', 'tok', tokenGetter);
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    ws.emitOpen();

    ws.emitMessage({ type: 'auction_ended', job_id: 'job-1' });
    ws.emitClose(1000);

    // No reconnect even after a long wait.
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(tokenGetter).not.toHaveBeenCalled();
  });

  it('schedules a reconnect attempt with ~1s backoff after an unexpected close', async () => {
    const tokenGetter = vi.fn(() => 'fresh-tok');
    auctionWsManager.connect('job-1', 'tok', tokenGetter);
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitClose(1006);

    // attemptReconnect calls tokenGetter() once for validation (synchronously
    // inside the close handler) before scheduling the backoff timer.
    expect(tokenGetter).toHaveBeenCalledTimes(1);

    // After the 1s backoff, the timer fires; the reconnect path awaits the
    // (no-op here, no refresher) refresh microtask, then calls tokenGetter
    // again for the actual reconnect attempt. advanceTimersByTimeAsync flushes
    // that microtask.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tokenGetter.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('refreshes the token before re-dialing on reconnect (BUG 2)', async () => {
    const tokenGetter = vi.fn(() => 'fresh-tok');
    const tokenRefresher = vi.fn(() => Promise.resolve(true));
    auctionWsManager.connect('job-1', 'tok', tokenGetter, tokenRefresher);
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitClose(1006);

    // The backoff timer fires → refresher runs → then a new socket is dialed.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tokenRefresher).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('keeps the token getter/refresher alive across successive reconnects', async () => {
    const tokenGetter = vi.fn(() => 'fresh-tok');
    const tokenRefresher = vi.fn(() => Promise.resolve(true));
    auctionWsManager.connect('job-1', 'tok', tokenGetter, tokenRefresher);
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    // First drop → reconnect.
    FakeWebSocket.last().emitClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last().emitOpen();

    // Second drop → reconnect must still work (hooks weren't lost when
    // doConnect() called disconnect() internally).
    FakeWebSocket.last().emitClose(1006);
    await vi.advanceTimersByTimeAsync(2000);
    expect(tokenRefresher.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('skips reconnect when no tokenGetter is registered', () => {
    auctionWsManager.connect('job-1', 'tok');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();
    FakeWebSocket.last().emitClose(1006);

    vi.advanceTimersByTime(60_000);
    // Only the original socket — no reconnect because tokenGetter is null.
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('disconnect() closes the socket, clears jobId, and goes disconnected', () => {
    auctionWsManager.connect('job-1', 'tok');
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    ws.emitOpen();

    auctionWsManager.disconnect();
    expect(ws.close).toHaveBeenCalled();
    expect(auctionWsManager.getStatus()).toBe('disconnected');
  });

  it('disconnect() during debounce cancels the pending socket open', () => {
    auctionWsManager.connect('job-1', 'tok');
    expect(FakeWebSocket.instances).toHaveLength(0);
    auctionWsManager.disconnect();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connect() called twice in rapid succession clears the prior debounce timer', () => {
    auctionWsManager.connect('job-A', 'tokA');
    expect(FakeWebSocket.instances).toHaveLength(0);

    // Second connect within the debounce window must clearTimeout the prior
    // schedule and replace it.
    auctionWsManager.connect('job-B', 'tokB');
    expect(FakeWebSocket.instances).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last().url).toContain('/ws/auction/job-B');
    expect(FakeWebSocket.last().url).not.toContain('token=');
    expect(FakeWebSocket.last().protocols).toEqual(['nomarkup.bearer.v1', 'tokB']);
  });

  it('onerror handler does not throw (intentionally a no-op; close handles reconnect)', () => {
    auctionWsManager.connect('job-1', 'tok');
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    expect(() => {
      ws.emitError();
    }).not.toThrow();
  });
});
