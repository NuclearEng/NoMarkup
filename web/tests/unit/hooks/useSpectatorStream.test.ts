import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSpectatorStream } from '@/hooks/useSpectatorStream';
import type { SpectatorMessage, SpectatorConnectionStatus } from '@/lib/spectator-websocket';

type MessageListener = (m: SpectatorMessage) => void;
type StatusListener = (s: SpectatorConnectionStatus) => void;

interface MockManager {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  __emitMessage: (m: SpectatorMessage) => void;
  __emitStatus: (s: SpectatorConnectionStatus) => void;
  __reset: () => void;
}

vi.mock('@/lib/spectator-websocket', () => {
  const messageListeners = new Set<MessageListener>();
  const statusListeners = new Set<StatusListener>();
  const manager: MockManager = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn((listener: MessageListener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    }),
    onStatusChange: vi.fn((listener: StatusListener) => {
      statusListeners.add(listener);
      // Match real behavior: emit current status synchronously on subscribe.
      listener('disconnected');
      return () => statusListeners.delete(listener);
    }),
    __emitMessage: (m: SpectatorMessage) => {
      messageListeners.forEach((l) => {
        l(m);
      });
    },
    __emitStatus: (s: SpectatorConnectionStatus) => {
      statusListeners.forEach((l) => {
        l(s);
      });
    },
    __reset: () => {
      messageListeners.clear();
      statusListeners.clear();
    },
  };
  return { spectatorWsManager: manager };
});

const { spectatorWsManager } = (await import('@/lib/spectator-websocket')) as unknown as {
  spectatorWsManager: MockManager;
};

describe('useSpectatorStream', () => {
  beforeEach(() => {
    spectatorWsManager.connect.mockClear();
    spectatorWsManager.disconnect.mockClear();
    spectatorWsManager.onMessage.mockClear();
    spectatorWsManager.onStatusChange.mockClear();
    spectatorWsManager.__reset();
  });
  afterEach(() => {
    spectatorWsManager.__reset();
  });

  it('returns disconnected default state when no jobId is supplied', () => {
    const { result } = renderHook(() => useSpectatorStream(undefined));

    expect(result.current.connectionStatus).toBe('disconnected');
    expect(result.current.events).toEqual([]);
    expect(result.current.bidCount).toBe(0);
    expect(result.current.spectatorCount).toBe(0);
    expect(result.current.isConnected).toBe(false);
    expect(spectatorWsManager.connect).not.toHaveBeenCalled();
  });

  it('connects and subscribes to message + status when given a jobId', () => {
    renderHook(() => useSpectatorStream('job-1'));

    expect(spectatorWsManager.connect).toHaveBeenCalledWith('job-1');
    expect(spectatorWsManager.onMessage).toHaveBeenCalledTimes(1);
    expect(spectatorWsManager.onStatusChange).toHaveBeenCalledTimes(1);
  });

  it('updates bid state when a bid_event message arrives', () => {
    const { result } = renderHook(() => useSpectatorStream('job-1'));

    act(() => {
      spectatorWsManager.__emitMessage({
        type: 'bid_event',
        job_id: 'job-1',
        data: { type: 'bid_placed', amount_cents: 25000, timestamp: '2026-04-25T00:00:00Z' },
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.bidCount).toBe(1);
    expect(result.current.currentLowest).toBe(25000);
  });

  it('keeps the lower of the two bids when a higher bid arrives later', () => {
    const { result } = renderHook(() => useSpectatorStream('job-1'));

    act(() => {
      spectatorWsManager.__emitMessage({
        type: 'bid_event',
        job_id: 'job-1',
        data: { type: 'bid_placed', amount_cents: 50000, timestamp: '2026-04-25T00:00:00Z' },
      });
      spectatorWsManager.__emitMessage({
        type: 'bid_event',
        job_id: 'job-1',
        data: { type: 'bid_placed', amount_cents: 75000, timestamp: '2026-04-25T00:00:01Z' },
      });
    });

    expect(result.current.bidCount).toBe(2);
    expect(result.current.currentLowest).toBe(50000);
  });

  it('updates spectatorCount when a spectator_count message arrives', () => {
    const { result } = renderHook(() => useSpectatorStream('job-1'));

    act(() => {
      spectatorWsManager.__emitMessage({
        type: 'spectator_count',
        job_id: 'job-1',
        spectator_count: 12,
      });
    });

    expect(result.current.spectatorCount).toBe(12);
  });

  it('reflects connection status changes and clears error when reconnected', () => {
    const { result } = renderHook(() => useSpectatorStream('job-1'));

    act(() => {
      spectatorWsManager.__emitStatus('disconnected');
    });
    expect(result.current.connectionStatus).toBe('disconnected');
    expect(result.current.error).toBe('WebSocket disconnected');

    act(() => {
      spectatorWsManager.__emitStatus('connected');
    });
    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.isConnected).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useSpectatorStream('job-1'));
    unmount();
    expect(spectatorWsManager.disconnect).toHaveBeenCalledTimes(1);
  });
});
