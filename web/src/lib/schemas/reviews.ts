// Review and review-reply forms.
import { REVIEW_RESPONSE_RULE } from '@/lib/text-rules';
import * as z from '@/lib/zod-mini';

import { starRating } from './_helpers';

export const reviewCommentSchema = z
  .string()
  .check(
    z.minLength(50, 'Review must be at least 50 characters'),
    z.maxLength(2000, 'Review must be at most 2000 characters'),
  );

export const ratingSchema = starRating();

// Review schemas
export const reviewSchema = z.object({
  overallRating: starRating(),
  // Customer → provider
  qualityRating: z.optional(starRating()),
  communicationRating: z.optional(starRating()),
  timelinessRating: z.optional(starRating()),
  valueRating: z.optional(starRating()),
  // Provider → customer (FR-6.2)
  paymentPromptnessRating: z.optional(starRating()),
  scopeAccuracyRating: z.optional(starRating()),
  accessRating: z.optional(starRating()),
  comment: z
    .string()
    .check(
      z.minLength(50, 'Comment must be at least 50 characters'),
      z.maxLength(2000, 'Comment must be at most 2000 characters'),
    ),
});
export type ReviewFormValues = z.infer<typeof reviewSchema>;

export const reviewResponseSchema = z
  .string()
  .check(
    z.minLength(REVIEW_RESPONSE_RULE.min, REVIEW_RESPONSE_RULE.minMessage),
    z.maxLength(REVIEW_RESPONSE_RULE.max, REVIEW_RESPONSE_RULE.maxMessage),
  );
