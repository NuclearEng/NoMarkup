// usePushSubscription — the status state machine around the Push API helpers.
// The helpers are mocked; Notification.requestPermission is the only browser
// surface the hook touches directly.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePushSubscription } from '@/hooks/usePushSubscription';
import {
  getPushPermissionStatus,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/web-push';

vi.mock('@/lib/web-push', () => ({
  getPushPermissionStatus: vi.fn(),
  isPushSupported: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

const requestPermission = vi.fn();

const stored = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

describe('usePushSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestPermission.mockReset();
    vi.stubGlobal('Notification', { requestPermission });
    vi.mocked(getPushPermissionStatus).mockReturnValue('default');
    vi.mocked(isPushSupported).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['unsupported', 'denied', 'granted', 'default'] as const)(
    'initialises status from the current permission (%s)',
    (permission) => {
      vi.mocked(getPushPermissionStatus).mockReturnValue(permission);

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.status).toBe(permission);
      expect(result.current.error).toBeNull();
    },
  );

  it('re-syncs on visibilitychange and stops listening after unmount', () => {
    const { result, unmount } = renderHook(() => usePushSubscription());
    expect(result.current.status).toBe('default');

    // The user flipped the OS-level toggle while the tab was hidden.
    vi.mocked(getPushPermissionStatus).mockReturnValue('denied');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.status).toBe('denied');

    unmount();
    const callsBefore = vi.mocked(getPushPermissionStatus).mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.mocked(getPushPermissionStatus).mock.calls).toHaveLength(callsBefore);
  });

  describe('subscribe', () => {
    it('marks unsupported without prompting when the Push API is missing', async () => {
      vi.mocked(isPushSupported).mockReturnValue(false);
      const { result } = renderHook(() => usePushSubscription());

      await act(async () => {
        await result.current.subscribe();
      });

      expect(result.current.status).toBe('unsupported');
      expect(requestPermission).not.toHaveBeenCalled();
      expect(vi.mocked(subscribeToPush)).not.toHaveBeenCalled();
    });

    it('goes pending while the prompt is open, then granted once subscribed', async () => {
      let resolvePermission: (value: NotificationPermission) => void = () => undefined;
      requestPermission.mockReturnValueOnce(
        new Promise<NotificationPermission>((resolve) => {
          resolvePermission = resolve;
        }),
      );
      vi.mocked(subscribeToPush).mockResolvedValueOnce(stored);
      const { result } = renderHook(() => usePushSubscription());

      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.subscribe();
      });
      expect(result.current.status).toBe('pending');

      await act(async () => {
        resolvePermission('granted');
        await pending;
      });

      expect(result.current.status).toBe('granted');
      expect(result.current.error).toBeNull();
      expect(vi.mocked(subscribeToPush)).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['denied', 'denied'],
      ['default', 'default'],
    ] as const)(
      'lands on %s without subscribing when the prompt resolves %s',
      async (permission, expected) => {
        requestPermission.mockResolvedValueOnce(permission);
        const { result } = renderHook(() => usePushSubscription());

        await act(async () => {
          await result.current.subscribe();
        });

        expect(result.current.status).toBe(expected);
        expect(vi.mocked(subscribeToPush)).not.toHaveBeenCalled();
      },
    );

    it.each<[string, unknown, string]>([
      ['an Error', new Error('VAPID public key is not configured.'), 'VAPID public key is not configured.'],
      ['a non-Error rejection', 'nope', 'unknown error'],
    ])('reports %s from subscribeToPush as an error status', async (_label, rejection, message) => {
      requestPermission.mockResolvedValueOnce('granted');
      vi.mocked(subscribeToPush).mockRejectedValueOnce(rejection);
      const { result } = renderHook(() => usePushSubscription());

      await act(async () => {
        await result.current.subscribe();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe(message);
    });

    it('clears a previous error when retried successfully', async () => {
      requestPermission.mockRejectedValueOnce(new Error('prompt blocked'));
      const { result } = renderHook(() => usePushSubscription());

      await act(async () => {
        await result.current.subscribe();
      });
      expect(result.current.error).toBe('prompt blocked');

      requestPermission.mockResolvedValueOnce('granted');
      vi.mocked(subscribeToPush).mockResolvedValueOnce(stored);
      await act(async () => {
        await result.current.subscribe();
      });

      expect(result.current.status).toBe('granted');
      expect(result.current.error).toBeNull();
    });
  });

  describe('unsubscribe', () => {
    it('unsubscribes then re-reads the permission state', async () => {
      vi.mocked(getPushPermissionStatus).mockReturnValue('granted');
      vi.mocked(unsubscribeFromPush).mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => usePushSubscription());
      await waitFor(() => {
        expect(result.current.status).toBe('granted');
      });

      vi.mocked(getPushPermissionStatus).mockReturnValue('default');
      await act(async () => {
        await result.current.unsubscribe();
      });

      expect(vi.mocked(unsubscribeFromPush)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(unsubscribeFromPush)).toHaveBeenCalledWith();
      expect(result.current.status).toBe('default');
      expect(result.current.error).toBeNull();
    });

    it.each<[string, unknown, string]>([
      ['an Error', new Error('worker gone'), 'worker gone'],
      ['a non-Error rejection', 42, 'unknown error'],
    ])('reports %s as an error status', async (_label, rejection, message) => {
      vi.mocked(unsubscribeFromPush).mockRejectedValueOnce(rejection);
      const { result } = renderHook(() => usePushSubscription());

      await act(async () => {
        await result.current.unsubscribe();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe(message);
    });
  });
});
