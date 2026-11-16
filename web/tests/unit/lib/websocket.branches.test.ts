// wsManager — the branches websocket.test.ts leaves untested: the same-origin
// URL fallback when resolveWsBase() yields nothing (browser and no-window),
// the escalating + capped + jittered reconnect delay, the "only a stably held
// connection resets the backoff" rule, the outbound queue filter on open, and
// the teardown races around the token refresh that precedes a re-dial.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  attemptRefresh: vi.fn(),
}));

vi.mock('@/lib/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/constants')>()),
  resolveWsBase: vi.fn(),
}));

import { attemptRefresh } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { resolveWsBase } from '@/lib/constants';
import { CONNECTION_STATUS, type ConnectionStatus, wsManager } from '@/lib/websocket';

type Handler<E> = ((ev: E) => void) | null;

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

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent> = null;
  onclose: Handler<CloseEvent> = null;
  onerror: Handler<Event> = null;
  send = vi.fn<(data: string) => void>();
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

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }

  sentFrames(): unknown[] {
    return this.send.mock.calls.map(([raw]) => JSON.parse(raw) as unknown);
  }
}

const DEBOUNCE_MS = 100;

/** Open the first socket of a test (connect + debounce). */
function dial(): FakeWebSocket {
  wsManager.connect();
  vi.advanceTimersByTime(DEBOUNCE_MS);
  return FakeWebSocket.last();
}

/**
 * Assert the pending reconnect fires exactly `delayMs` after the close: nothing
 * is dialed one millisecond early, and a new socket exists once the delay plus
 * the connect debounce has elapsed.
 */
async function expectRedialAfter(delayMs: number): Promise<FakeWebSocket> {
  const before = FakeWebSocket.instances.length;
  const refreshesBefore = vi.mocked(attemptRefresh).mock.calls.length;

  await vi.advanceTimersByTimeAsync(delayMs - 1);
  expect(vi.mocked(attemptRefresh).mock.calls).toHaveLength(refreshesBefore);
  expect(FakeWebSocket.instances).toHaveLength(before);

  await vi.advanceTimersByTimeAsync(1);
  expect(vi.mocked(attemptRefresh).mock.calls).toHaveLength(refreshesBefore + 1);

  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  expect(FakeWebSocket.instances).toHaveLength(before + 1);
  return FakeWebSocket.last();
}

describe('wsManager branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.mocked(getAccessToken).mockReturnValue('jwt-token');
    vi.mocked(attemptRefresh).mockResolvedValue(true);
    vi.mocked(resolveWsBase).mockReturnValue('ws://resolved.test');
    // jitter(d) = round(d/2 + random * d/2): random 0 pins it to exactly d/2.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    wsManager.disconnect();
  });

  afterEach(() => {
    wsManager.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('socket URL', () => {
    it('uses the resolver result when it yields a base', () => {
      const ws = dial();
      expect(ws.url).toBe('ws://resolved.test/ws/chat');
    });

    it('falls back to the page origin (ws: for an http page) when the resolver yields nothing', () => {
      vi.mocked(resolveWsBase).mockReturnValue('');
      expect(window.location.protocol).toBe('http:');

      const ws = dial();

      expect(ws.url).toBe(`ws://${window.location.host}/ws/chat`);
    });

    it('falls back to a relative path when there is neither a resolver result nor a window', () => {
      vi.mocked(resolveWsBase).mockReturnValue('');
      vi.stubGlobal('window', undefined);

      const ws = dial();

      expect(ws.url).toBe('/ws/chat');
    });
  });

  describe('connect guards', () => {
    it('does not dial or change status when no access token is available', () => {
      vi.mocked(getAccessToken).mockReturnValue(null);
      const statuses: ConnectionStatus[] = [];
      const off = wsManager.onStatusChange((s) => {
        statuses.push(s);
      });

      wsManager.connect();
      vi.advanceTimersByTime(DEBOUNCE_MS);

      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(statuses).toEqual([]);
      off();
    });

    it('is a no-op while the existing socket is still mid-handshake', () => {
      const ws = dial();
      expect(ws.readyState).toBe(FakeWebSocket.CONNECTING);

      wsManager.connect();
      vi.advanceTimersByTime(DEBOUNCE_MS);

      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('dials a replacement when the held socket is CLOSING (neither open nor connecting)', () => {
      const ws = dial();
      ws.emitOpen();
      ws.readyState = FakeWebSocket.CLOSING;

      wsManager.connect();
      vi.advanceTimersByTime(DEBOUNCE_MS);

      expect(FakeWebSocket.instances).toHaveLength(2);
    });
  });

  describe('status + message listeners', () => {
    it('notifies only on a real transition and stops after unsubscribe', () => {
      const statuses: ConnectionStatus[] = [];
      const off = wsManager.onStatusChange((s) => {
        statuses.push(s);
      });

      // Already disconnected: a second disconnect() is not a transition.
      wsManager.disconnect();
      expect(statuses).toEqual([]);

      const ws = dial();
      ws.emitOpen();
      expect(statuses).toEqual([CONNECTION_STATUS.CONNECTING, CONNECTION_STATUS.CONNECTED]);
      expect(wsManager.isConnected).toBe(true);

      off();
      wsManager.disconnect();
      expect(statuses).toHaveLength(2);
      expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.DISCONNECTED);
    });

    it('stops delivering inbound frames to a listener once it unsubscribes', () => {
      const received: unknown[] = [];
      const off = wsManager.onMessage((m) => {
        received.push(m);
      });
      const ws = dial();
      ws.emitOpen();
      const frame = { type: 'typing', channel_id: 'c-1', user_id: 'u-1' };

      ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
      off();
      ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));

      expect(received).toEqual([frame]);
    });
  });

  describe('outbound queue', () => {
    it('queues frames sent before any socket exists and delivers only the transient ones on open', () => {
      // No socket at all yet — every frame is queued.
      wsManager.subscribe('chan-A');
      wsManager.sendTyping('chan-A');
      wsManager.subscribe('chan-B');
      wsManager.unsubscribe('chan-B');

      const ws = dial();
      expect(ws.send).not.toHaveBeenCalled();
      ws.emitOpen();

      // subscribe(chan-A) comes from the authoritative replay (once, not also
      // from the queue); the queued subscribe/unsubscribe for chan-B are
      // dropped so an unsubscribed channel is not resurrected; typing flows.
      expect(ws.sentFrames()).toEqual([
        { type: 'subscribe', channel_id: 'chan-A' },
        { type: 'typing', channel_id: 'chan-A' },
      ]);
    });

    it('drops queued frames and tracked subscriptions on disconnect()', () => {
      const first = dial();
      wsManager.subscribe('chan-A');
      wsManager.sendTyping('chan-A');
      wsManager.disconnect();
      expect(first.close).toHaveBeenCalledTimes(1);

      const second = dial();
      second.emitOpen();

      expect(second).not.toBe(first);
      expect(second.send).not.toHaveBeenCalled();
    });
  });

  describe('reconnect backoff', () => {
    it('escalates 1s → 2s → 4s … and caps at 30s (jittered to half) while attempts keep failing', async () => {
      let ws = dial();

      // Each attempt opens and is dropped immediately (gateway accepted the
      // upgrade, backend down): the open must NOT reset the delay.
      for (const expected of [500, 1000, 2000, 4000, 8000, 15_000, 15_000]) {
        ws.emitOpen();
        ws.emitClose();
        ws = await expectRedialAfter(expected);
      }
    });

    it('applies jitter from Math.random within [delay/2, delay)', async () => {
      vi.mocked(Math.random).mockReturnValue(0.5);
      const ws = dial();
      ws.emitClose();

      // 1000ms base → 500 + 0.5 * 500.
      await expectRedialAfter(750);
    });

    it('resets to the base delay once a connection was held for the stability window', async () => {
      let ws = dial();
      ws.emitClose();
      ws = await expectRedialAfter(500);
      ws.emitClose();
      ws = await expectRedialAfter(1000);

      ws.emitOpen();
      await vi.advanceTimersByTimeAsync(5000);
      ws.emitClose();

      await expectRedialAfter(500);
    });

    it('keeps escalating when the connection dropped just short of the stability window', async () => {
      let ws = dial();
      ws.emitClose();
      ws = await expectRedialAfter(500);

      ws.emitOpen();
      await vi.advanceTimersByTimeAsync(4999);
      ws.emitClose();

      await expectRedialAfter(1000);
    });

    it('starts from the base delay again after an explicit disconnect()', async () => {
      let ws = dial();
      ws.emitClose();
      ws = await expectRedialAfter(500);
      ws.emitClose();
      await expectRedialAfter(1000);

      wsManager.disconnect();
      ws = dial();
      ws.emitClose();

      await expectRedialAfter(500);
    });

    it('schedules a single reconnect when the close handler fires twice', async () => {
      const ws = dial();
      const onclose = ws.onclose;
      ws.emitClose();
      onclose?.(new CloseEvent('close', { code: 1006 }));

      await vi.advanceTimersByTimeAsync(60_000);

      expect(vi.mocked(attemptRefresh)).toHaveBeenCalledTimes(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('still re-dials when the token refresh reports failure', async () => {
      vi.mocked(attemptRefresh).mockResolvedValue(false);
      const ws = dial();
      ws.emitClose();

      const next = await expectRedialAfter(500);

      expect(next.url).toBe('ws://resolved.test/ws/chat');
    });

    it('does not re-dial when disconnect() lands while the token refresh is in flight', async () => {
      let finishRefresh: (ok: boolean) => void = () => undefined;
      vi.mocked(attemptRefresh).mockReturnValue(
        new Promise<boolean>((resolve) => {
          finishRefresh = resolve;
        }),
      );
      const ws = dial();
      ws.emitClose();
      await vi.advanceTimersByTimeAsync(500);
      expect(vi.mocked(attemptRefresh)).toHaveBeenCalledTimes(1);

      wsManager.disconnect();
      finishRefresh(true);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(wsManager.connectionStatus).toBe(CONNECTION_STATUS.DISCONNECTED);
    });

    it('does not schedule a reconnect for the close that follows disconnect()', async () => {
      const ws = dial();
      ws.emitOpen();
      const onclose = ws.onclose;

      wsManager.disconnect();
      // The browser delivers the close event after our own close() call.
      onclose?.(new CloseEvent('close', { code: 1000 }));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(vi.mocked(attemptRefresh)).not.toHaveBeenCalled();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });
});
