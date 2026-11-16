// web-push — the subscribe / unsubscribe flows that web-push.test.ts leaves
// out. jsdom has no service worker, PushManager or Notification, so a fake
// push surface is installed. The module reads NEXT_PUBLIC_VAPID_PUBLIC_KEY at
// import time, so it is re-imported per test after stubbing the env.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

// Bytes 251,255,254 → standard base64 "+//+", url-safe "-__-": exercises the
// alphabet swap. A 2-char key ("AQ" → byte 1) exercises the padding.
const VAPID_URL_SAFE = '-__-';

interface FakeSubscription {
  toJSON: () => unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function subscriptionOf(json: unknown): FakeSubscription {
  return { toJSON: () => json, unsubscribe: vi.fn().mockResolvedValue(true) };
}

const completeJSON = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

const getSubscription = vi.fn();
const pushSubscribe = vi.fn();
const getRegistration = vi.fn();
const register = vi.fn();

const registration = { pushManager: { getSubscription, subscribe: pushSubscribe } };

function installPush(): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration, register },
  });
  vi.stubGlobal('PushManager', function PushManager() {
    // constructor presence only
  });
  vi.stubGlobal('Notification', { permission: 'granted' });
}

async function load(vapidKey: string | undefined) {
  vi.resetModules();
  if (vapidKey === undefined) {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', undefined);
  } else {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', vapidKey);
  }
  const mod = await import('@/lib/web-push');
  const { api } = await import('@/lib/api');
  return { ...mod, api: vi.mocked(api) };
}

describe('web-push subscribe/unsubscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSubscription.mockReset();
    pushSubscribe.mockReset();
    getRegistration.mockReset();
    register.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  describe('feature detection', () => {
    it('is unsupported on the server (no window)', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      vi.stubGlobal('window', undefined);

      expect(mod.isPushSupported()).toBe(false);
      expect(mod.getPushPermissionStatus()).toBe('unsupported');
    });

    it.each([
      ['PushManager', () => vi.stubGlobal('Notification', { permission: 'granted' })],
      ['Notification', () => vi.stubGlobal('PushManager', vi.fn())],
    ])('is unsupported when a service worker exists but %s is missing', async (_missing, stubOther) => {
      const mod = await load(VAPID_URL_SAFE);
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { getRegistration, register },
      });
      stubOther();

      expect(mod.isPushSupported()).toBe(false);
    });
  });

  describe('ensureServiceWorker', () => {
    it('returns null without touching the service worker when push is unsupported', async () => {
      const mod = await load(VAPID_URL_SAFE);

      await expect(mod.ensureServiceWorker()).resolves.toBeNull();
      expect(getRegistration).not.toHaveBeenCalled();
    });

    it('reuses an existing /sw.js registration', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockResolvedValueOnce(registration);

      await expect(mod.ensureServiceWorker()).resolves.toBe(registration);
      expect(getRegistration).toHaveBeenCalledWith('/sw.js');
      expect(register).not.toHaveBeenCalled();
    });

    it('registers /sw.js at root scope when none exists', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockResolvedValueOnce(undefined);
      register.mockResolvedValueOnce(registration);

      await expect(mod.ensureServiceWorker()).resolves.toBe(registration);
      expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    it.each([
      ['lookup', () => getRegistration.mockRejectedValueOnce(new Error('SecurityError'))],
      [
        'registration',
        () => {
          getRegistration.mockResolvedValueOnce(undefined);
          register.mockRejectedValueOnce(new Error('blocked'));
        },
      ],
    ])('degrades to null when the %s rejects', async (_label, arrange) => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      arrange();

      await expect(mod.ensureServiceWorker()).resolves.toBeNull();
    });
  });

  describe('subscribeToPush', () => {
    it('throws when the browser has no Push API', async () => {
      const mod = await load(VAPID_URL_SAFE);

      await expect(mod.subscribeToPush()).rejects.toThrow(
        'Push notifications are not supported in this browser.',
      );
      expect(mod.api.post).not.toHaveBeenCalled();
    });

    it.each([
      ['unset', undefined],
      ['empty', ''],
    ])('throws when the VAPID key is %s, before registering a worker', async (_label, key) => {
      const mod = await load(key);
      installPush();

      await expect(mod.subscribeToPush()).rejects.toThrow('VAPID public key is not configured.');
      expect(getRegistration).not.toHaveBeenCalled();
    });

    it('throws when the service worker cannot be registered', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockRejectedValueOnce(new Error('private mode'));

      await expect(mod.subscribeToPush()).rejects.toThrow('Service worker registration failed.');
      expect(mod.api.post).not.toHaveBeenCalled();
    });

    it('creates a subscription with the decoded VAPID key and stores it on the gateway', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(null);
      pushSubscribe.mockResolvedValueOnce(subscriptionOf(completeJSON));
      mod.api.post.mockResolvedValueOnce({});

      const stored = await mod.subscribeToPush();

      expect(stored).toStrictEqual(completeJSON);
      expect(pushSubscribe).toHaveBeenCalledTimes(1);
      const options = pushSubscribe.mock.calls[0]?.[0] as {
        userVisibleOnly: boolean;
        applicationServerKey: Uint8Array;
      };
      expect(options.userVisibleOnly).toBe(true);
      expect(Array.from(options.applicationServerKey)).toEqual([251, 255, 254]);
      expect(mod.api.post.mock.calls).toStrictEqual([
        [
          '/api/v1/me/push-subscriptions',
          {
            endpoint: completeJSON.endpoint,
            keys: completeJSON.keys,
            user_agent: navigator.userAgent,
          },
        ],
      ]);
    });

    it('pads a VAPID key whose length is not a multiple of four', async () => {
      const mod = await load('AQ');
      installPush();
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(null);
      pushSubscribe.mockResolvedValueOnce(subscriptionOf(completeJSON));
      mod.api.post.mockResolvedValueOnce({});

      await mod.subscribeToPush();

      const options = pushSubscribe.mock.calls[0]?.[0] as { applicationServerKey: Uint8Array };
      expect(Array.from(options.applicationServerKey)).toEqual([1]);
    });

    it('reuses an existing browser subscription and still re-POSTs it', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(subscriptionOf(completeJSON));
      mod.api.post.mockResolvedValueOnce({});

      const stored = await mod.subscribeToPush();

      expect(pushSubscribe).not.toHaveBeenCalled();
      expect(stored.endpoint).toBe(completeJSON.endpoint);
      expect(mod.api.post).toHaveBeenCalledTimes(1);
    });

    it.each<[string, unknown]>([
      ['no endpoint', { keys: completeJSON.keys }],
      ['no keys object', { endpoint: completeJSON.endpoint }],
      ['no p256dh key', { endpoint: completeJSON.endpoint, keys: { auth: 'a' } }],
      ['no auth key', { endpoint: completeJSON.endpoint, keys: { p256dh: 'p' } }],
      ['an empty endpoint', { endpoint: '', keys: completeJSON.keys }],
    ])('rejects a subscription with %s and stores nothing', async (_label, json) => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(subscriptionOf(json));

      await expect(mod.subscribeToPush()).rejects.toThrow(
        'Browser returned an incomplete push subscription.',
      );
      expect(mod.api.post).not.toHaveBeenCalled();
    });

    it('propagates a permission rejection from pushManager.subscribe', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      const denied = new Error('Registration failed - permission denied');
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(null);
      pushSubscribe.mockRejectedValueOnce(denied);

      await expect(mod.subscribeToPush()).rejects.toBe(denied);
      expect(mod.api.post).not.toHaveBeenCalled();
    });

    it('propagates a gateway failure so the caller can surface it', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      const failure = new Error('500');
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(subscriptionOf(completeJSON));
      mod.api.post.mockRejectedValueOnce(failure);

      await expect(mod.subscribeToPush()).rejects.toBe(failure);
    });
  });

  describe('unsubscribeFromPush', () => {
    it('is a no-op when push is unsupported', async () => {
      const mod = await load(VAPID_URL_SAFE);

      await mod.unsubscribeFromPush('sub-1');

      expect(getRegistration).not.toHaveBeenCalled();
      expect(mod.api.delete).not.toHaveBeenCalled();
    });

    it('is a no-op (no gateway DELETE) when no service worker is available', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockRejectedValueOnce(new Error('blocked'));

      await mod.unsubscribeFromPush('sub-1');

      expect(getSubscription).not.toHaveBeenCalled();
      expect(mod.api.delete).not.toHaveBeenCalled();
    });

    it('unsubscribes locally and deletes the gateway row by id', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      const existing = subscriptionOf(completeJSON);
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(existing);
      mod.api.delete.mockResolvedValueOnce(undefined);

      await mod.unsubscribeFromPush('sub-1');

      expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
      expect(mod.api.delete.mock.calls).toEqual([['/api/v1/me/push-subscriptions/sub-1']]);
    });

    it('unsubscribes locally only when no subscription id is known', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      const existing = subscriptionOf(completeJSON);
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(existing);

      await mod.unsubscribeFromPush();

      expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
      expect(mod.api.delete).not.toHaveBeenCalled();
    });

    it('still deletes the gateway row when the browser has no subscription', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(null);
      mod.api.delete.mockResolvedValueOnce(undefined);

      await mod.unsubscribeFromPush('sub-2');

      expect(mod.api.delete).toHaveBeenCalledWith('/api/v1/me/push-subscriptions/sub-2');
    });

    it('still deletes the gateway row when the local unsubscribe throws', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      const existing = subscriptionOf(completeJSON);
      existing.unsubscribe.mockRejectedValueOnce(new Error('InvalidStateError'));
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(existing);
      mod.api.delete.mockResolvedValueOnce(undefined);

      await expect(mod.unsubscribeFromPush('sub-3')).resolves.toBeUndefined();

      expect(mod.api.delete).toHaveBeenCalledWith('/api/v1/me/push-subscriptions/sub-3');
    });

    it('swallows a gateway DELETE failure (the row is reaped on the next 410)', async () => {
      const mod = await load(VAPID_URL_SAFE);
      installPush();
      const existing = subscriptionOf(completeJSON);
      getRegistration.mockResolvedValueOnce(registration);
      getSubscription.mockResolvedValueOnce(existing);
      mod.api.delete.mockRejectedValueOnce(new Error('404'));

      await expect(mod.unsubscribeFromPush('sub-4')).resolves.toBeUndefined();

      expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
      expect(mod.api.delete).toHaveBeenCalledTimes(1);
    });
  });
});
