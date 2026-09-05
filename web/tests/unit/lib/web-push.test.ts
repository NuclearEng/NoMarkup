import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We exercise the pure helpers exposed by /lib/web-push.ts. The DOM-side
// subscribe flow needs a heavyweight push mock; the small surface tested
// here covers the SSR-safety branches and the permission status mapping
// that drive the UI's gating logic.

import {
  getPushPermissionStatus,
  isPushSupported,
} from '@/lib/web-push';

describe('web-push helpers', () => {
  const originalServiceWorker = (
    globalThis as unknown as { navigator?: { serviceWorker?: unknown } }
  ).navigator?.serviceWorker;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (
      originalServiceWorker !== undefined &&
      typeof globalThis !== 'undefined' &&
      'navigator' in globalThis
    ) {
      Object.defineProperty(globalThis.navigator, 'serviceWorker', {
        configurable: true,
        value: originalServiceWorker,
      });
    }
  });

  it('reports unsupported when the runtime lacks the Push API', () => {
    // jsdom does not ship Notification / PushManager — the helper must
    // detect this gracefully so SSR/tests don't blow up.
    expect(isPushSupported()).toBe(false);
    expect(getPushPermissionStatus()).toBe('unsupported');
  });

  it('returns the current Notification.permission when supported', () => {
    // Synthesize the bare-minimum global surface isPushSupported() probes.
    const fakeServiceWorker = { register: vi.fn() };
    const fakeNotification = {
      permission: 'granted' as NotificationPermission,
      requestPermission: vi.fn(),
    };

    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: fakeServiceWorker,
    });
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function PushManager() {
      // empty — only constructor presence is probed
    };
    (globalThis as unknown as { Notification?: unknown }).Notification = fakeNotification;

    expect(isPushSupported()).toBe(true);
    expect(getPushPermissionStatus()).toBe('granted');

    fakeNotification.permission = 'denied';
    expect(getPushPermissionStatus()).toBe('denied');

    fakeNotification.permission = 'default';
    expect(getPushPermissionStatus()).toBe('default');

    // Cleanup so other tests are not poisoned.
    delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  });
});
