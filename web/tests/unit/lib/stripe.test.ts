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

  it('falls back to empty string when the env var is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', '');
    const { loadStripe } = await import('@stripe/stripe-js');
    vi.mocked(loadStripe).mockReturnValue(Promise.resolve(null));

    const { getStripe } = await import('@/lib/stripe');
    void getStripe();

    expect(loadStripe).toHaveBeenCalledWith('');
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
});
