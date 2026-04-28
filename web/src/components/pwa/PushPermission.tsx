'use client';

// PushPermission — inline soft-prompt that asks an authenticated user
// to enable browser push. We never call Notification.requestPermission()
// outside of a user gesture: a hard prompt without context burns the
// permission for the lifetime of the install. Instead, we render this
// small inline card on the first auth'd visit and only fire the real
// permission request when the user clicks "Yes".
//
// Visibility rules:
//   * Only renders when `authed` is true (caller-supplied).
//   * Only renders when the browser supports push and permission is
//     'default' (never asked yet).
//   * Hidden if the user has dismissed in this session (sessionStorage).
//   * Hidden if a successful subscription already exists (localStorage
//     'pwa:push-subscribed') so we don't reprompt across reloads.

import { useEffect, useState } from 'react';

import { usePushSubscription } from '@/hooks/usePushSubscription';

const SUBSCRIBED_KEY = 'pwa:push-subscribed';
const DISMISS_KEY = 'pwa:push-dismissed';

interface PushPermissionProps {
  authed: boolean;
}

export function PushPermission({ authed }: PushPermissionProps): React.ReactElement | null {
  const { status, subscribe, error } = usePushSubscription();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!authed) {
      setHidden(true);
      return;
    }
    try {
      const subscribed = window.localStorage.getItem(SUBSCRIBED_KEY) === 'true';
      const dismissed = window.sessionStorage.getItem(DISMISS_KEY) === 'true';
      setHidden(subscribed || dismissed);
    } catch {
      setHidden(false);
    }
  }, [authed]);

  // Persist 'subscribed' as soon as the hook flips to granted — guards
  // against an over-eager re-render reshowing the prompt mid-flight.
  useEffect(() => {
    if (status === 'granted' && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SUBSCRIBED_KEY, 'true');
      } catch {
        // ignore
      }
      setHidden(true);
    }
  }, [status]);

  if (!authed || hidden) return null;
  if (status !== 'default' && status !== 'pending' && status !== 'error') return null;

  const onDismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // ignore
    }
    setHidden(true);
  };

  return (
    <div
      role="region"
      aria-label="Push notification permission"
      className="bg-card text-card-foreground fixed bottom-4 right-4 z-30 w-[min(90vw,22rem)] rounded-lg border border-border p-4 shadow-md"
    >
      <h2 className="text-sm font-semibold">Get pinged when an auction is closing</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        Turn on browser push so you don&apos;t miss outbids on the items you&apos;re watching.
      </p>
      {status === 'error' && error ? (
        <p className="text-destructive mt-2 text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void subscribe()}
          disabled={status === 'pending'}
          className="bg-primary text-primary-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:opacity-90 disabled:opacity-60"
        >
          {status === 'pending' ? 'Asking…' : 'Turn on'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:underline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

export default PushPermission;
