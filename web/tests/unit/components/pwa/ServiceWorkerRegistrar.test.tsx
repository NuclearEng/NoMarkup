import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';

// Regression guard for the production infinite hard-reload loop:
// while web/public/sw.js is the temporary self-destruct ("kill-switch")
// build, the registrar must NEVER register it — in any environment.
// Registering it produced: register → install(skipWaiting) → activate →
// unregister + client.navigate() → page remounts → register again → ∞.
// Instead the registrar performs the kill-switch's cleanup from the page:
// unregister all existing registrations + purge all caches.

interface SWMocks {
  register: ReturnType<typeof vi.fn>;
  getRegistrations: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  cacheKeys: ReturnType<typeof vi.fn>;
  cacheDelete: ReturnType<typeof vi.fn>;
}

function installServiceWorkerMocks(): SWMocks {
  const unregister = vi.fn().mockResolvedValue(true);
  const register = vi.fn().mockResolvedValue({ scope: '/' });
  const getRegistrations = vi
    .fn()
    .mockResolvedValue([{ unregister }, { unregister }]);

  Object.defineProperty(window.navigator, 'serviceWorker', {
    writable: true,
    configurable: true,
    value: { register, getRegistrations },
  });

  const cacheKeys = vi.fn().mockResolvedValue(['nomarkup-v1', 'nomarkup-v2']);
  const cacheDelete = vi.fn().mockResolvedValue(true);
  Object.defineProperty(window, 'caches', {
    writable: true,
    configurable: true,
    value: { keys: cacheKeys, delete: cacheDelete },
  });

  return { register, getRegistrations, unregister, cacheKeys, cacheDelete };
}

async function expectCleanupWithoutRegistration(mocks: SWMocks): Promise<void> {
  render(<ServiceWorkerRegistrar />);

  await waitFor(() => {
    expect(mocks.getRegistrations).toHaveBeenCalledTimes(1);
    // Both existing (stale) registrations are unregistered.
    expect(mocks.unregister).toHaveBeenCalledTimes(2);
    // Every cache is purged.
    expect(mocks.cacheDelete).toHaveBeenCalledTimes(2);
  });
  expect(mocks.cacheDelete).toHaveBeenCalledWith('nomarkup-v1');
  expect(mocks.cacheDelete).toHaveBeenCalledWith('nomarkup-v2');

  // The loop-causing call: must never happen while sw.js is the kill-switch.
  expect(mocks.register).not.toHaveBeenCalled();
}

describe('ServiceWorkerRegistrar', () => {
  let mocks: SWMocks;

  beforeEach(() => {
    mocks = installServiceWorkerMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('production: does NOT register /sw.js; unregisters existing SWs and purges caches', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expectCleanupWithoutRegistration(mocks);
  });

  it('development: same cleanup — no registration, unregister + cache purge', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await expectCleanupWithoutRegistration(mocks);
  });

  it('renders nothing and survives cleanup failures (no crash, no registration)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.getRegistrations.mockRejectedValueOnce(new Error('SecurityError'));

    const { container } = render(<ServiceWorkerRegistrar />);
    expect(container).toBeEmptyDOMElement();

    await waitFor(() => {
      expect(mocks.getRegistrations).toHaveBeenCalledTimes(1);
    });
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
