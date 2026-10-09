import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @stripe/stripe-js BEFORE importing the module under test so the mock
// is in place when stripe.ts captures the publishable key + loadStripe ref.
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(),
}));

describe('lib/stripe', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lazily calls loadStripe with the publishable key on first invocation', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_abc123');
    const { loadStripe } = await import('@stripe/stripe-js');
    const fakePromise = Promise.resolve(null);
    vi.mocked(loadStripe).mockReturnValue(fakePromise);

    const { getStripe } = await import('@/lib/stripe');
    const result = getStripe();

    expect(loadStripe).toHaveBeenCalledTimes(1);
    expect(loadStripe).toHaveBeenCalledWith('pk_test_abc123');
    expect(result).toBe(fakePromise);
  });

  it('returns the cached promise on subsequent calls (no second loadStripe)', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_abc123');
    const { loadStripe } = await import('@stripe/stripe-js');
    const fakePromise = Promise.resolve(null);
    vi.mocked(loadStripe).mockReturnValue(fakePromise);

    const { getStripe } = await import('@/lib/stripe');
    const first = getStripe();
    const second = getStripe();
    const third = getStripe();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(loadStripe).toHaveBeenCalledTimes(1);
  });

  it('does NOT call loadStripe when the key is empty (degrades gracefully)', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', '');
    const { loadStripe } = await import('@stripe/stripe-js');
    vi.mocked(loadStripe).mockReturnValue(Promise.resolve(null));

    const { getStripe } = await import('@/lib/stripe');
    // Must not call loadStripe('') (which throws "IntegrationError: empty
    // string"); instead resolve to null so callers show a "not set up" state.
    await expect(getStripe()).resolves.toBeNull();
    expect(loadStripe).not.toHaveBeenCalled();
  });

  it('does NOT call loadStripe for the docs placeholder key', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_...');
    const { loadStripe } = await import('@stripe/stripe-js');
    vi.mocked(loadStripe).mockReturnValue(Promise.resolve(null));

    const { getStripe, isStripeConfigured } = await import('@/lib/stripe');
    await expect(getStripe()).resolves.toBeNull();
    expect(loadStripe).not.toHaveBeenCalled();
    expect(isStripeConfigured()).toBe(false);
  });

  it('isStripeConfigured reflects whether a usable key is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_abc123');
    const { isStripeConfigured } = await import('@/lib/stripe');
    expect(isStripeConfigured()).toBe(true);
  });

  it('returns a Promise (so consumers can await it)', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_x');
    const { loadStripe } = await import('@stripe/stripe-js');
    vi.mocked(loadStripe).mockReturnValue(Promise.resolve(null));

    const { getStripe } = await import('@/lib/stripe');
    const result = getStripe();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeNull();
  });

  it('degrades gracefully (no loadStripe, resolves null) when the env var is undefined', async () => {
    // Stash and delete to make the key truly undefined (rather than empty),
    // exercising the `?? ''` branch in stripe.ts.
    const previous = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    try {
      const { loadStripe } = await import('@stripe/stripe-js');
      vi.mocked(loadStripe).mockReturnValue(Promise.resolve(null));

      const { getStripe } = await import('@/lib/stripe');
      await expect(getStripe()).resolves.toBeNull();
      expect(loadStripe).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) {
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = previous;
      }
    }
  });
});
