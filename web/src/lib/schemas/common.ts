// Field-level schemas shared by more than one form.
import { PHONE_RULE } from '@/lib/text-rules';
import * as z from '@/lib/zod-mini';

export const emailSchema = z.email('Invalid email address');

export const passwordSchema = z
  .string()
  .check(
    z.minLength(8, 'Password must be at least 8 characters'),
    z.maxLength(128, 'Password must be at most 128 characters'),
    z.regex(/[A-Z]/, 'Password must contain at least one uppercase letter'),
    z.regex(/[a-z]/, 'Password must contain at least one lowercase letter'),
    z.regex(/[0-9]/, 'Password must contain at least one number'),
    z.regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  );

export const displayNameSchema = z
  .string()
  .check(
    z.minLength(2, 'Display name must be at least 2 characters'),
    z.maxLength(100, 'Display name must be at most 100 characters'),
  );

// Single-string rules live in `text-rules.ts` so components that only check one
// field can do it without loading Zod; the schemas here are built from them.
export const phoneSchema = z.string().check(z.regex(PHONE_RULE.pattern, PHONE_RULE.patternMessage));
