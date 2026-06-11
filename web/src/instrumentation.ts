/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Used for CLAUDE.md §12 startup env validation: in production the server
 * refuses to boot when a required variable is missing; in development it
 * logs a structured warning and continues.
 *
 * Guards (must not break `next build`, must stay out of the edge bundle):
 *   - NEXT_RUNTIME check: only the Node.js server validates — the edge
 *     runtime has its own restricted env and never needs the full set.
 *   - NEXT_PHASE check: `next build` sets NODE_ENV=production and may load
 *     this module in build workers; validation is a *runtime* gate, so it is
 *     skipped during the build phase.
 *   - Dynamic import: no top-level throw at module-import time, and the
 *     server-only env module is never statically reachable from edge/client.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env['NEXT_PHASE'] === 'phase-production-build') return;

  const { validateServerEnv } = await import('./lib/server/env');
  validateServerEnv();
}
