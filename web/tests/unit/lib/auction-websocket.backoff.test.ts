// auctionWsManager — reconnect backoff must grow and the attempt cap must
// hold. Every re-dial used to pass through disconnect(), which zeroed the
// attempt counter, so retries came ~1s apart forever.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auctionWsManager } from '@/lib/auction-websocket';
import { STABLE_CONNECTION_MS } from '@/lib/ws-backoff';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('no WebSocket has been constructed');
    return socket;
  }

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {}
  open(): void {
    this.onopen?.(new Event('open'));
  }
  drop(): void {
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }
}

const DEBOUNCE_MS = 100;

function connectAndDial(jobId: string): FakeWebSocket {
  auctionWsManager.connect(jobId, 'tok', () => 'tok');
  vi.advanceTimersByTime(DEBOUNCE_MS);
  return FakeWebSocket.last();
}

/** Expects no re-dial until exactly `ms` after the last drop, then one. */
async function expectRedialAfter(ms: number): Promise<void> {
  const before = FakeWebSocket.instances.length;
  await vi.advanceTimersByTimeAsync(ms - 1);
  expect(FakeWebSocket.instances).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(FakeWebSocket.instances).toHaveLength(before + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  // jitter(d) = d/2 + random * d/2, so random = 1 makes the delay exactly d.
  vi.spyOn(Math, 'random').mockReturnValue(1);
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  auctionWsManager.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('auctionWsManager reconnect backoff', () => {
  it('doubles the delay after each failed attempt and caps it at 30s', async () => {
    connectAndDial('job-1').drop();

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      await expectRedialAfter(delay);
      FakeWebSocket.last().drop();
    }
  });

  it('keeps escalating when the gateway accepts and then drops straight away', async () => {
    connectAndDial('job-1').drop();

    await expectRedialAfter(1_000);
    FakeWebSocket.last().open();
    FakeWebSocket.last().drop();
    await expectRedialAfter(2_000);
  });

  it('stops re-dialing after 10 failed attempts', async () => {
    connectAndDial('job-1').drop();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
      FakeWebSocket.last().drop();
    }
    expect(FakeWebSocket.instances).toHaveLength(11);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeWebSocket.instances).toHaveLength(11);
    expect(auctionWsManager.getStatus()).toBe('disconnected');
  });

  it('starts over at 1s after a connection that stayed up', async () => {
    connectAndDial('job-1').drop();
    await expectRedialAfter(1_000);
    FakeWebSocket.last().drop();
    await expectRedialAfter(2_000);

    FakeWebSocket.last().open();
    await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS);
    FakeWebSocket.last().drop();

    await expectRedialAfter(1_000);
  });

  it('starts over at 1s after a deliberate disconnect and a new connect', async () => {
    connectAndDial('job-1').drop();
    await expectRedialAfter(1_000);
    FakeWebSocket.last().drop();
    await expectRedialAfter(2_000);

    auctionWsManager.disconnect();
    connectAndDial('job-1').drop();

    await expectRedialAfter(1_000);
  });

  it('starts over at 1s when the caller connects to a different job', async () => {
    connectAndDial('job-1').drop();
    await expectRedialAfter(1_000);
    FakeWebSocket.last().drop();

    connectAndDial('job-2').drop();

    await expectRedialAfter(1_000);
  });
});
