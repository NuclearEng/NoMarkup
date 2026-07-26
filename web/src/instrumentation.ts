/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Two jobs:
 *
 * 1. **Sentry server/edge initialization.** From @sentry/nextjs v9 onward the
 *    build plugin only auto-injects the *client* config file; the Node and Edge
 *    `Sentry.init()` calls must be imported from here or they never run.
 *    Verified against the installed SDK (10.49.0): `build/cjs/config/webpack.js`
 *    injects `sentry.client.config.*` / `instrumentation-client.*` into the
 *    browser entrypoints only — there is no server-side equivalent anywhere in
 *    the package. Without the imports below, every Server Component / route
 *    handler / server action error is silently dropped.
 *
 * 2. **CLAUDE.md §12 startup env validation**: in production the server refuses
 *    to boot when a required variable is missing; in development it logs a
 *    structured warning and continues.
 *
 * Guards:
 *   - NEXT_RUNTIME check: the Node.js server gets the Node SDK + full env
 *     validation; the edge runtime gets the (much smaller) edge SDK and never
 *     needs the full env set — it has its own restricted env.
 *   - NEXT_PHASE check: `next build` sets NODE_ENV=production and may load this
 *     module in build workers; env validation is a *runtime* gate, so it is
 *     skipped during the build phase. Sentry init is deliberately NOT gated on
 *     the build phase — that matches the SDK's documented contract, and it means
 *     failures during static generation are reported too. With no DSN configured
 *     (the CI case) `Sentry.init` is a no-op.
 *   - Dynamic imports: no top-level `Sentry.init()`, no top-level throw at
 *     module-import time, and the server-only env module is never statically
 *     reachable from the edge or client bundles.
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
    return;
  }

  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Initialize before validating env so that a fatal missing-variable throw is
  // itself captured by the SDK's global error handlers.
  await import('../sentry.server.config');

  if (process.env['NEXT_PHASE'] === 'phase-production-build') return;

  const { validateServerEnv } = await import('./lib/server/env');
  validateServerEnv();
}

/**
 * Next.js calls this for every error thrown while rendering a Server Component,
 * running a route handler, or executing a server action. Forwarding it to
 * `Sentry.captureRequestError` is the only way those errors reach Sentry in the
 * App Router — `global-error.tsx` only covers client-side React render errors.
 */
export const onRequestError = Sentry.captureRequestError;
