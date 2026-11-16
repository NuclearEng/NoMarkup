// auctionWsManager — a token refresher that rejects must not leave an
// unhandled promise rejection, and the re-dial still happens (the manager's
// rule is "reconnect even if the refresh fails").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auctionWsManager } from '@/lib/auction-websocket';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {}
  drop(): void {
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }
}

const unhandled: unknown[] = [];
function onUnhandled(reason: unknown): void {
  unhandled.push(reason);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(1);
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  auctionWsManager.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Let Node run its unhandled-rejection check, which fires after microtasks. */
async function settle(): Promise<void> {
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('auctionWsManager with a rejecting token refresher', () => {
  it('re-dials with the current token and leaves no unhandled rejection', async () => {
    const refresher = vi.fn(() => Promise.reject(new Error('refresh endpoint down')));
    auctionWsManager.connect('job-1', 'tok-1', () => 'tok-2', refresher);
    vi.advanceTimersByTime(100);
    FakeWebSocket.instances[0]?.drop();

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(refresher).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]?.protocols).toEqual(['nomarkup.bearer.v1', 'tok-2']);
    expect(unhandled).toEqual([]);
  });

  it('does not re-dial when the rejected refresh also left no token', async () => {
    let token: string | null = 'tok-1';
    const refresher = vi.fn(() => {
      token = null;
      return Promise.reject(new Error('session revoked'));
    });
    auctionWsManager.connect('job-1', 'tok-1', () => token, refresher);
    vi.advanceTimersByTime(100);
    FakeWebSocket.instances[0]?.drop();

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(auctionWsManager.getStatus()).toBe('disconnected');
    expect(unhandled).toEqual([]);
  });
});
