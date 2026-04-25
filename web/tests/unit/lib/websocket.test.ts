import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock auth so we control the token attached to the WebSocket URL.
vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(),
}));

import { getAccessToken } from '@/lib/auth';
import {
  CONNECTION_STATUS,
  WS_SERVER_MSG,
  type WsServerMessage,
  wsManager,
} from '@/lib/websocket';

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

describe('wsManager (chat WebSocket client)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.mocked(getAccessToken).mockReturnValue('jwt-token');
    // Reset internal singleton state so each test starts disconnected.
    wsManager.disconnect();
  });

  afterEach(() => {
    wsManager.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts disconnected', () => {
    expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.DISCONNECTED);
    expect(wsManager.isConnected).toBe(false);
  });

  it('connect() debounces socket creation by 100ms', () => {
    wsManager.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);

    vi.advanceTimersByTime(99);
    expect(FakeWebSocket.instances).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('builds the WebSocket URL with the URL-encoded access token', () => {
    vi.mocked(getAccessToken).mockReturnValue('tok with space&plus');
    wsManager.connect();
    vi.advanceTimersByTime(100);

    const ws = FakeWebSocket.last();
    expect(ws.url).toContain('/ws/chat?token=');
    // Token must be URL-encoded.
    expect(ws.url).toContain('tok%20with%20space%26plus');
  });

  it('does not open a socket if no access token is available', () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    wsManager.connect();
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.DISCONNECTED);
  });

  it('flips status to CONNECTED on socket open and notifies status listeners', () => {
    const statuses: string[] = [];
    const off = wsManager.onStatusChange((s) => statuses.push(s));

    wsManager.connect();
    vi.advanceTimersByTime(100);
    expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.CONNECTING);

    FakeWebSocket.last().emitOpen();
    expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.CONNECTED);
    expect(wsManager.isConnected).toBe(true);

    expect(statuses).toEqual([CONNECTION_STATUS.CONNECTING, CONNECTION_STATUS.CONNECTED]);
    off();
  });

  it('dispatches inbound messages to all subscribed listeners', () => {
    const aReceived: WsServerMessage[] = [];
    const bReceived: WsServerMessage[] = [];
    const offA = wsManager.onMessage((m) => aReceived.push(m));
    const offB = wsManager.onMessage((m) => bReceived.push(m));

    wsManager.connect();
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    const payload = {
      type: WS_SERVER_MSG.UNREAD_UPDATE,
      channel_id: 'chan-1',
      unread_count: 3,
    };
    FakeWebSocket.last().emitMessage(payload);

    expect(aReceived).toHaveLength(1);
    expect(bReceived).toHaveLength(1);
    expect(aReceived[0]).toMatchObject({ channel_id: 'chan-1', unread_count: 3 });

    // Unsubscribed listeners stop receiving.
    offA();
    FakeWebSocket.last().emitMessage({ ...payload, unread_count: 4 });
    expect(aReceived).toHaveLength(1);
    expect(bReceived).toHaveLength(2);
    offB();
  });

  it('silently swallows malformed JSON messages', () => {
    const received: WsServerMessage[] = [];
    wsManager.onMessage((m) => received.push(m));

    wsManager.connect();
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();

    expect(() => {
      FakeWebSocket.last().emitRawMessage('not-json{');
    }).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('subscribe()/unsubscribe()/sendTyping() send JSON-serialized client messages when OPEN', () => {
    wsManager.connect();
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    ws.emitOpen();

    wsManager.subscribe('chan-A');
    wsManager.unsubscribe('chan-B');
    wsManager.sendTyping('chan-A');

    expect(ws.send).toHaveBeenCalledTimes(3);
    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>);
    expect(sent[0]).toEqual({ type: 'subscribe', channel_id: 'chan-A' });
    expect(sent[1]).toEqual({ type: 'unsubscribe', channel_id: 'chan-B' });
    expect(sent[2]).toEqual({ type: 'typing', channel_id: 'chan-A' });
  });

  it('queues outbound messages while CONNECTING and flushes them on open', () => {
    wsManager.connect();
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    // Force CONNECTING so send() takes the queue path.
    ws.readyState = FakeWebSocket.CONNECTING;

    wsManager.subscribe('chan-Q1');
    wsManager.subscribe('chan-Q2');
    expect(ws.send).not.toHaveBeenCalled();

    // Open the socket → queue should be flushed.
    ws.emitOpen();
    expect(ws.send).toHaveBeenCalledTimes(2);
    const flushed = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>);
    expect(flushed[0]).toEqual({ type: 'subscribe', channel_id: 'chan-Q1' });
    expect(flushed[1]).toEqual({ type: 'subscribe', channel_id: 'chan-Q2' });
  });

  it('reconnects with exponential backoff after an unexpected close', () => {
    wsManager.connect();
    vi.advanceTimersByTime(100);
    const ws1 = FakeWebSocket.last();
    ws1.emitOpen();

    // Server-side close (not initiated by us).
    ws1.emitClose(1006);
    expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.DISCONNECTED);

    // Reconnect timer fires after 1000ms (initial backoff), then we still
    // need to wait the 100ms debounce for the new socket to actually open.
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('does NOT reconnect when disconnect() is called explicitly', () => {
    wsManager.connect();
    vi.advanceTimersByTime(100);
    const ws = FakeWebSocket.last();
    ws.emitOpen();

    wsManager.disconnect();
    expect(ws.close).toHaveBeenCalled();
    expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.DISCONNECTED);

    // Even after a long wait, no reconnect should be scheduled.
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('disconnect() during the debounce window cancels socket creation', () => {
    wsManager.connect();
    // Debounce in flight, no socket yet.
    expect(FakeWebSocket.instances).toHaveLength(0);

    wsManager.disconnect();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connect() while OPEN is a no-op (no second socket)', () => {
    wsManager.connect();
    vi.advanceTimersByTime(100);
    FakeWebSocket.last().emitOpen();
    expect(FakeWebSocket.instances).toHaveLength(1);

    wsManager.connect();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
