// Shared building blocks for the form schemas in this folder. Everything here
// is written against `zod/mini` — see `src/lib/zod-mini.ts` for why.
import * as z from '@/lib/zod-mini';

/** Optional field that also accepts '' (classic: `.optional().or(z.literal(''))`). */
export function optionalOrEmpty<T extends z.ZodMiniType>(schema: T) {
  return z.union([z.optional(schema), z.literal('')]);
}

/** Integer 1–5 star rating. */
export function starRating() {
  return z.number().check(z.int(), z.minimum(1), z.maximum(5));
}

/** Literal 0 mapped to `undefined` — an empty (0) amount counts as unset. */
export function zeroAsUndefined() {
  return z.pipe(
    z.literal(0),
    z.transform(() => undefined),
  );
}
