'use client';

// usePushSubscription — small client-side state machine wrapping the
// W3C Push API. Exposes a typed status that the UI can switch on:
//
//   'unsupported' → browser doesn't support push (iOS Safari < 16.4, etc.)
//   'denied'      → user previously declined; Notification.permission is locked
//   'granted'     → user accepted and we have a subscription on file
//   'default'     → user hasn't been asked yet (first eligible visit)
//   'pending'     → an in-flight subscribe/unsubscribe is running
//   'error'       → last action failed; check `error` for the message
//
// PushPermission.tsx is the only consumer in the tree today; the hook is
// kept generic so a future settings page can also surface a toggle.

import { useCallback, useEffect, useState } from 'react';

import {
  getPushPermissionStatus,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupportStatus,
} from '@/lib/web-push';

export type PushHookStatus = PushSupportStatus | 'pending' | 'error';

interface UsePushSubscriptionResult {
  status: PushHookStatus;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushSubscription(): UsePushSubscriptionResult {
  const [status, setStatus] = useState<PushHookStatus>('unknown');
  const [error, setError] = useState<string | null>(null);

  // Initialize from Notification.permission on mount. Re-running on every
  // visibilitychange catches the case where the user flips the OS-level
  // notification toggle while the tab is open.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      setStatus(getPushPermissionStatus());
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus('unsupported');
      return;
    }
    setStatus('pending');
    setError(null);
    try {
      // Notification.requestPermission may be a Promise (modern) or take a
      // legacy callback. The Promise form is universal in our supported
      // matrix (Chrome 64+, Firefox 67+, Edge, Safari 16.4+).
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'default');
        return;
      }
      await subscribeToPush();
      setStatus('granted');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      setError(message);
      setStatus('error');
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setStatus('pending');
    setError(null);
    try {
      await unsubscribeFromPush();
      setStatus(getPushPermissionStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      setError(message);
      setStatus('error');
    }
  }, []);

  return { status, error, subscribe, unsubscribe };
}
