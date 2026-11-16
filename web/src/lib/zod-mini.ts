/**
 * Client-side Zod entry point — `zod/mini` with the English locale registered.
 *
 * Why this exists (PERF-07/08): the classic `zod` build attaches every method
 * to every schema instance, so it cannot be tree-shaken — one `z.string()` in
 * a client component ships ~25 kB gzip. `zod/mini` exposes the same validators
 * as standalone functions, so only what a schema actually uses is bundled.
 *
 * `zod/mini` does not register a locale by itself (classic does, lazily), and
 * without one every un-messaged issue reads "Invalid input". Registering `en`
 * here keeps the default messages identical to the classic build.
 *
 * Usage: `import * as z from '@/lib/zod-mini';` — a namespace import, so the
 * bundler can still drop unused validators. Server-only code (route handlers,
 * `lib/server/*`) may keep importing classic `zod`.
 */
import { config } from 'zod/mini';
import en from 'zod/v4/locales/en.js';

config(en());

export * from 'zod/mini';
