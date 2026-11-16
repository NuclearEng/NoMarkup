// Listing (goods marketplace) posting form.
import * as z from '@/lib/zod-mini';

import { optionalOrEmpty } from './_helpers';

export const listingTitleSchema = z
  .string()
  .check(
    z.minLength(5, 'Title must be at least 5 characters'),
    z.maxLength(120, 'Title must be at most 120 characters'),
  );

export const listingDescriptionSchema = z
  .string()
  .check(
    z.minLength(20, 'Description must be at least 20 characters'),
    z.maxLength(5000, 'Description must be at most 5000 characters'),
  );

export const listingZipSchema = z
  .string()
  .check(z.regex(/^\d{5}(-\d{4})?$/, 'Pickup zip must be a valid 5-digit zip code'));

export const listingPostingSchema = z
  .object({
    categoryId: z.string().check(z.minLength(1, 'Category is required')),
    title: listingTitleSchema,
    description: listingDescriptionSchema,
    photoUrls: z
      .array(z.url('Each photo must be a valid URL'))
      .check(
        z.minLength(1, 'At least one photo is required'),
        z.maxLength(10, 'You can upload up to 10 photos'),
      ),
    pickupZip: listingZipSchema,
    pickupAddress: optionalOrEmpty(z.string().check(z.maxLength(200))),
    startingPriceDollars: z
      .number()
      .check(
        z.positive('Starting price must be greater than $0'),
        z.maximum(1_000_000, 'Starting price is too large'),
      ),
    buyNowDollars: z.optional(
      z
        .number()
        .check(
          z.positive('Buy now must be greater than $0'),
          z.maximum(1_000_000, 'Buy now price is too large'),
        ),
    ),
    auctionDurationHours: z.union([z.literal(24), z.literal(48), z.literal(168)], {
      error: (issue) => (issue.input === undefined ? 'Pick an auction duration' : undefined),
    }),
    // Condition is optional — empty string = "seller didn't say".
    condition: z.optional(
      z.enum(['', 'new', 'like_new', 'very_good', 'good', 'acceptable', 'for_parts']),
    ),
  })
  .check(
    z.superRefine((values, ctx) => {
      if (values.buyNowDollars === undefined) return;
      const buyCents = Math.round(values.buyNowDollars * 100);
      const startCents = Math.round(values.startingPriceDollars * 100);
      if (buyCents < startCents) {
        ctx.addIssue({
          code: 'custom',
          path: ['buyNowDollars'],
          message: 'Buy now must be at least the starting price.',
        });
      }
    }),
  );

export type ListingPostingFormValues = z.infer<typeof listingPostingSchema>;
