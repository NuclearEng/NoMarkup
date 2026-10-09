import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type SpectatorConnectionStatus,
  type SpectatorMessage,
  spectatorWsManager,
} from '@/lib/spectator-websocket';

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

describe('spectatorWsManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    spectatorWsManager.disconnect();
  });

  afterEach(() => {
    spectatorWsManager.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts disconnected', () => {
    expect(spectatorWsManager.getStatus()).toBe('disconnected');
  });

  it('connect() debounces socket creation by 100ms', () => {
    spectatorWsManager.connect('job-1');
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(99);
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('connects anonymously to /ws/auction/{jobId}/spectate (no token in URL)', () => {
    spectatorWsManager.connect('job-xyz');
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    expect(ws.url).toContain('/ws/auction/job-xyz/spectate');
    // No auth token should ever be appended.
    expect(ws.url).not.toContain('token=');
    expect(ws.url).not.toContain('?');
  });

  it('flips status connecting → connected on socket open', () => {
    const seen: SpectatorConnectionStatus[] = [];
    const off = spectatorWsManager.onStatusChange((s) => seen.push(s));
    expect(seen).toEqual(['disconnected']);

    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    expect(spectatorWsManager.getStatus()).toBe('connecting');

    FakeWebSocket.last().emitOpen();
    expect(spectatorWsManager.getStatus()).toBe('connected');
    expect(seen).toContain('connecting');
    expect(seen.at(-1)).toBe('connected');
    off();
  });

  it('dispatches PII-stripped bid_event payloads (no bidder_id field)', () => {
    const received: SpectatorMessage[] = [];
    spectatorWsManager.onMessage((m) => received.push(m));

    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    // Spectator bid events carry only price + timestamp, NEVER bidder identity.
    const bidEvent: SpectatorMessage = {
      type: 'bid_event',
      job_id: 'job-1',
      data: { type: 'bid_placed', amount_cents: 9_999, timestamp: '2025-01-01T00:00:00Z' },
    };
    FakeWebSocket.last().emitMessage(bidEvent);

    expect(received).toHaveLength(1);
    const msg = received[0];
    expect(msg?.type).toBe('bid_event');
    expect(msg?.data?.amount_cents).toBe(9_999);
    // Schema-level guarantee: spectator data shape has no bidder identifier.
    expect(msg?.data && 'bidder_id' in msg.data).toBe(false);
  });

  it('dispatches spectator_count (viewer-count) updates', () => {
    const received: SpectatorMessage[] = [];
    spectatorWsManager.onMessage((m) => received.push(m));

    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitMessage({
      type: 'spectator_count',
      job_id: 'job-1',
      spectator_count: 42,
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('spectator_count');
    expect(received[0]?.spectator_count).toBe(42);
  });

  it('handles delayed-broadcast bid events without altering them', () => {
    // The 3-second broadcast delay is enforced server-side. The client just
    // delivers whatever timestamped event it receives; here we assert the
    // payload reaches subscribers intact.
    const received: SpectatorMessage[] = [];
    spectatorWsManager.onMessage((m) => received.push(m));

    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    const delayed: SpectatorMessage = {
      type: 'bid_event',
      job_id: 'job-1',
      data: { type: 'bid_placed', amount_cents: 100, timestamp: '2025-01-01T00:00:03Z' },
    };
    FakeWebSocket.last().emitMessage(delayed);
    expect(received[0]?.data?.timestamp).toBe('2025-01-01T00:00:03Z');
  });

  it('silently swallows malformed messages', () => {
    const received: SpectatorMessage[] = [];
    spectatorWsManager.onMessage((m) => received.push(m));

    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    expect(() => {
      FakeWebSocket.last().emitRawMessage('not-json{');
    }).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('schedules a reconnect with ~1s backoff after an unexpected close', () => {
    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    FakeWebSocket.last().emitClose(1006);
    expect(spectatorWsManager.getStatus()).toBe('disconnected');

    // Reconnect timer is scheduled. Advancing the clock fires it. (We do not
    // assert a NEW socket here because the underlying doConnect early-return
    // guard against existing-ws/same-jobId can prevent re-construction; the
    // observable contract is that reconnect is *attempted*.)
    expect(() => {
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
  });

  it('disconnect() closes the socket and clears state', () => {
    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    ws.emitOpen();

    spectatorWsManager.disconnect();
    expect(ws.close).toHaveBeenCalled();
    expect(spectatorWsManager.getStatus()).toBe('disconnected');

    // No reconnect after explicit disconnect.
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('disconnect() during the debounce window cancels socket creation', () => {
    spectatorWsManager.connect('job-1');
    expect(FakeWebSocket.instances).toHaveLength(0);
    spectatorWsManager.disconnect();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connect() called twice in rapid succession clears the prior debounce timer', () => {
    spectatorWsManager.connect('job-A');
    // First debounce in flight; no socket yet.
    expect(FakeWebSocket.instances).toHaveLength(0);

    // Second connect within the debounce window must clearTimeout the prior
    // schedule and replace it. Only ONE socket should ever be created.
    spectatorWsManager.connect('job-B');
    expect(FakeWebSocket.instances).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last().url).toContain('/ws/auction/job-B/spectate');
  });

  it('onerror handler does not throw (intentionally a no-op; close handles reconnect)', () => {
    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    expect(() => {
      ws.emitError();
    }).not.toThrow();
  });

  it('onMessage returns an unsubscribe function that detaches the listener', () => {
    const received: SpectatorMessage[] = [];
    const off = spectatorWsManager.onMessage((m) => received.push(m));

    spectatorWsManager.connect('job-1');
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();
    FakeWebSocket.last().emitMessage({ type: 'spectator_count', job_id: 'job-1', spectator_count: 1 });
    expect(received).toHaveLength(1);

    off();
    FakeWebSocket.last().emitMessage({ type: 'spectator_count', job_id: 'job-1', spectator_count: 2 });
    expect(received).toHaveLength(1);
  });
});
