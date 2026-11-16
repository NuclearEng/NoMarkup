// Property schemas — `street` is the form field; the API nests it inside
// `address: { street, city, state, zip_code, ... }`.
import * as z from '@/lib/zod-mini';

export const propertySchema = z.object({
  nickname: z.string().check(z.minLength(1, 'Nickname is required'), z.maxLength(100)),
  street: z.string().check(z.minLength(1, 'Street is required')),
  city: z.string().check(z.minLength(1, 'City is required')),
  state: z.string().check(z.minLength(1, 'State is required'), z.maxLength(2)),
  zip_code: z.string().check(z.regex(/^\d{5}(-\d{4})?$/, 'Invalid zip code')),
  notes: z.optional(z.string().check(z.maxLength(500))),
});

export type PropertyFormValues = z.infer<typeof propertySchema>;
