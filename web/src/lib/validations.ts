// Every client form schema, re-exported from one place.
//
// The schemas live in `src/lib/schemas/<domain>.ts`. APP CODE SHOULD IMPORT
// FROM THE DOMAIN MODULE (`@/lib/schemas/auth`, `@/lib/schemas/jobs`, …), not
// from here: this file evaluates every schema, so importing one name from it
// puts all of them — job posting, listings, provider onboarding, … — into the
// importing route's JavaScript (PERF-08). It is kept for tests and for code
// that genuinely needs the whole set.
//
// All schemas are written against `zod/mini` (standalone validator functions,
// tree-shakable) instead of the classic chained API (~25 kB gzip regardless of
// usage). Semantics, issue order and every error message are identical to the
// classic definitions: `x.min(n, m)` → `x.check(z.minLength(n, m))`,
// `x.optional()` → `z.optional(x)`, `a.or(b)` → `z.union([a, b])`,
// `x.refine(f, p)` → `x.check(z.refine(f, p))`, `x.transform(f)` →
// `z.pipe(x, z.transform(f))`.
export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/jobs';
export * from './schemas/bids';
export * from './schemas/reviews';
export * from './schemas/profile';
export * from './schemas/provider';
export * from './schemas/contracts';
export * from './schemas/chat';
export * from './schemas/properties';
export * from './schemas/listings';
