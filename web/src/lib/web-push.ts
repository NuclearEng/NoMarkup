// Web Push helpers — browser-side subscribe/unsubscribe + send to gateway.
//
// VAPID flow:
//   1. Server publishes a public key as NEXT_PUBLIC_VAPID_PUBLIC_KEY.
//   2. We pass the URL-safe-base64 key as Uint8Array to pushManager.subscribe.
//   3. Browser returns a PushSubscription with { endpoint, keys: { p256dh, auth } }.
//   4. We POST that to /api/v1/me/push-subscriptions; gateway upserts and
//      services/notification fans out via webpush-go using the same VAPID pair.
//
// All functions here are SSR-safe — they no-op or throw with a typed error
// when window/navigator is undefined or the browser does not support push.

import { api } from '@/lib/api';

export type PushSupportStatus =
  | 'unsupported'
  | 'denied'
  | 'granted'
  | 'default'
  | 'unknown';

export interface StoredSubscription {
  id?: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const VAPID_PUBLIC_KEY = process.env['NEXT_PUBLIC_VAPID_PUBLIC_KEY'] ?? '';

/**
 * Returns true iff the runtime supports the W3C Push API. False on the
 * server, in browsers without service workers, in iOS Safari < 16.4, etc.
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Maps the current Notification.permission state to a typed status — saves
 * callers from string-equality checks and centralizes the unsupported case.
 */
export function getPushPermissionStatus(): PushSupportStatus {
  if (!isPushSupported()) return 'unsupported';
  // NotificationPermission narrows to 'granted' | 'denied' | 'default'.
  return Notification.permission;
}

/**
 * Registers (or returns the existing) service worker registration. The hook
 * relies on this to drive PushManager.subscribe — without an active
 * registration the subscribe call rejects.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/sw.js');
    if (existing) return existing;
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    // Registration can fail in private mode, on http://, or when the
    // browser blocks SW for the origin. Non-fatal — push features
    // simply degrade. The caller surfaces a typed error if needed.
    return null;
  }
}

/**
 * VAPID keys arrive as URL-safe base64 strings; PushManager.subscribe
 * wants a Uint8Array. We pad to a multiple of 4 and swap the URL-safe
 * alphabet back to standard base64 before atob.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    out[i] = rawData.charCodeAt(i);
  }
  return out;
}

/**
 * Subscribes the active service worker to push notifications and POSTs
 * the resulting PushSubscription to the gateway. Throws on any failure
 * — callers should catch and surface a toast.
 */
export async function subscribeToPush(): Promise<StoredSubscription> {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser.');
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('VAPID public key is not configured.');
  }
  const registration = await ensureServiceWorker();
  if (!registration) {
    throw new Error('Service worker registration failed.');
  }

  // Reuse the existing subscription if one is already attached. The
  // browser returns the same endpoint for a given (origin, VAPID key),
  // so this is genuinely idempotent — re-POSTing keeps the gateway row
  // fresh (last_seen_at) without creating duplicates.
  const existing = await registration.pushManager.getSubscription();
  // PushManager.subscribe wants a BufferSource. The lib.dom.d.ts narrowing
  // for `applicationServerKey` rejects a generic ArrayBufferLike Uint8Array
  // (TS thinks it might be backed by a SharedArrayBuffer); we copy into a
  // brand-new ArrayBuffer-backed Uint8Array so the type narrows cleanly.
  const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const applicationServerKey = new Uint8Array(new ArrayBuffer(keyBytes.length));
  applicationServerKey.set(keyBytes);
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Browser returned an incomplete push subscription.');
  }

  const stored: StoredSubscription = {
    endpoint,
    keys: { p256dh, auth },
  };

  await api.post('/api/v1/me/push-subscriptions', {
    endpoint: stored.endpoint,
    keys: stored.keys,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  });

  return stored;
}

/**
 * Unsubscribes locally and tells the gateway to drop the row. We pass the
 * id we stashed at subscribe-time when we have it; otherwise the gateway
 * resolves by endpoint match.
 */
export async function unsubscribeFromPush(subscriptionId?: string): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await ensureServiceWorker();
  if (!registration) return;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    try {
      await existing.unsubscribe();
    } catch {
      // Local unsubscribe is best-effort. The gateway DELETE below
      // (and 410 reaping in the dispatcher) covers the server side.
    }
  }
  if (subscriptionId) {
    try {
      await api.delete(`/api/v1/me/push-subscriptions/${subscriptionId}`);
    } catch {
      // best-effort; the row will be reaped on the next 410 Gone anyway.
    }
  }
}
