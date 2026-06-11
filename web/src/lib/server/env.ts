/**
 * Server-side environment validation (CLAUDE.md §12: required env vars are
 * validated with a Zod schema at startup; the app fails fast if missing).
 *
 * Invoked from `src/instrumentation.ts` when a Next.js server instance starts
 * (`next start` / `next dev`) — NOT at build time and NOT in the edge runtime
 * (the instrumentation hook guards on NEXT_RUNTIME/NEXT_PHASE). Nothing here
 * runs at module-import time, so importing this file can never break a build.
 *
 * Server-only: never import this from a client component. It is only wired
 * into the instrumentation hook, which exists exclusively on the server, so
 * no values listed here leak into client bundles.
 *
 * Behavior:
 *   - production (NODE_ENV === 'production'): throw a single aggregated Error
 *     naming every missing/invalid variable → the server process fails fast.
 *   - development: log one structured warning and continue (dev runs fine on
 *     code fallbacks: localhost API, derived WS URL, etc.).
 */
import { z } from 'zod';

/**
 * Variables the production web server cannot run correctly without.
 *
 *   API_URL                  server-side gateway base for RSC page fetches
 *   NEXT_PUBLIC_SITE_URL     canonical origin for metadata/robots/sitemap
 *   NEXT_PUBLIC_MAPBOX_TOKEN map rendering (job/listing locations)
 *   NEXT_PUBLIC_WS_URL       CSP connect-src + spectator/chat sockets
 *   JWT_PUBLIC_KEY_PATH      verifies access JWTs on the paid-LLM API routes
 */
const productionRequiredSchema = z.object({
  API_URL: z.string().url(),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().min(1),
  NEXT_PUBLIC_WS_URL: z.string().url(),
  JWT_PUBLIC_KEY_PATH: z.string().min(1),
});

export type ServerEnvIssue = {
  /** Environment variable name, e.g. "API_URL". */
  name: string;
  /** Human-readable problem, e.g. "Required" or "Invalid url". */
  message: string;
};

/**
 * Pure check: returns one issue per missing/invalid production-required
 * variable. Empty strings count as missing. Never throws, never logs.
 */
export function collectServerEnvIssues(
  env: Record<string, string | undefined> = process.env,
): ServerEnvIssue[] {
  // Normalize empty strings to undefined so "VAR=" in an env file is
  // reported as "Required" rather than passing a vacuous min-length check.
  const candidate: Record<string, string | undefined> = {};
  for (const key of Object.keys(productionRequiredSchema.shape)) {
    const value = env[key];
    candidate[key] = value === '' ? undefined : value;
  }

  const result = productionRequiredSchema.safeParse(candidate);
  if (result.success) return [];

  return result.error.issues.map((issue) => ({
    name: String(issue.path[0] ?? '(unknown)'),
    message: issue.code === 'invalid_type' ? 'Required' : issue.message,
  }));
}

/**
 * Validate the server environment. Throws in production when anything is
 * missing (fail fast, with every problem listed in one message); logs a
 * structured warning in development.
 */
export function validateServerEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  const issues = collectServerEnvIssues(env);
  if (issues.length === 0) return;

  const detail = issues.map((i) => `${i.name} (${i.message})`).join(', ');

  if (env['NODE_ENV'] === 'production') {
    throw new Error(
      `Missing or invalid required environment variables: ${detail}. ` +
        'The production web server refuses to start without them (CLAUDE.md §12). ' +
        'See .env.example for documentation of each variable.',
    );
  }

  // Development: warn once, structured, and continue on code fallbacks.
  // This runs at server startup before any app logger exists, and the
  // payload is structured JSON (same precedent as src/lib/stripe.ts).
  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'web',
      message:
        'environment variables missing; running on dev fallbacks (production would fail fast)',
      missing: issues.map((i) => i.name),
    }),
  );
}
