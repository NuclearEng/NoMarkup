import { loadStripe, type Stripe } from '@stripe/stripe-js';

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

// A usable publishable key starts with "pk_" and is not the docs placeholder
// ("pk_test_..."). When the key is missing or a placeholder, calling
// loadStripe('') throws "IntegrationError: ... You used an empty string",
// which surfaces as unhandled promise rejections and breaks every Stripe
// Elements surface (bid bonds, payment methods, promoted listings, admin
// banking). Treat that as "Stripe not configured" and degrade gracefully.
function isUsableKey(key: string): boolean {
  return key.startsWith('pk_') && !key.includes('...');
}

let stripePromise: Promise<Stripe | null> | null = null;
let warned = false;

/**
 * Lazily loads and returns the Stripe.js instance.
 * Reuses the same promise on subsequent calls.
 *
 * Returns a promise that resolves to `null` (never rejects) when no valid
 * publishable key is configured, so callers can show a "payments unavailable"
 * state instead of crashing. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in
 * web/.env.local to a real Stripe test key (pk_test_…) to enable payments.
 */
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (isUsableKey(stripePublishableKey)) {
      stripePromise = loadStripe(stripePublishableKey);
    } else {
      if (!warned && typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.warn(
          'Stripe is not configured: set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in web/.env.local. Payment features are disabled.',
        );
        warned = true;
      }
      stripePromise = Promise.resolve(null);
    }
  }
  return stripePromise;
}

/** Whether a valid Stripe publishable key is configured (for UI gating). */
export function isStripeConfigured(): boolean {
  return isUsableKey(stripePublishableKey);
}
