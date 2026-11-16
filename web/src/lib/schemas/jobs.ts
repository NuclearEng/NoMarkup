// Job posting wizard and the legal-intake variant.
import * as z from '@/lib/zod-mini';

import { zeroAsUndefined } from './_helpers';

export const jobTitleSchema = z
  .string()
  .check(
    z.minLength(10, 'Title must be at least 10 characters'),
    z.maxLength(200, 'Title must be at most 200 characters'),
  );

export const jobDescriptionSchema = z
  .string()
  .check(
    z.minLength(50, 'Description must be at least 50 characters'),
    z.maxLength(5000, 'Description must be at most 5000 characters'),
  );

// Job posting schema
export const jobPostingSchema = z
  .object({
    categoryId: z.string().check(z.minLength(1, 'Category is required')),
    title: jobTitleSchema,
    description: jobDescriptionSchema,
    scheduleType: z.union(
      [z.literal('specific_date'), z.literal('date_range'), z.literal('flexible')],
      { error: (issue) => (issue.input === undefined ? 'Schedule type is required' : undefined) },
    ),
    scheduledDate: z.optional(z.string()),
    isRecurring: z.boolean(),
    recurrenceFrequency: z.optional(
      z.union([
        z.literal('weekly'),
        z.literal('biweekly'),
        z.literal('monthly'),
        z.literal('quarterly'),
      ]),
    ),
    locationAddress: z.optional(z.string()),
    locationLat: z.optional(z.number()),
    locationLng: z.optional(z.number()),
    startingBidDollars: z.union([
      z.optional(z.number().check(z.positive('Starting bid must be positive'))),
      zeroAsUndefined(),
    ]),
    offerAcceptedDollars: z.union([
      z.optional(z.number().check(z.positive('Accepted offer must be positive'))),
      zeroAsUndefined(),
    ]),
    auctionDurationHours: z
      .number()
      .check(
        z.int('Duration must be a whole number'),
        z.minimum(24, 'Minimum auction duration is 24 hours'),
        z.maximum(168, 'Maximum auction duration is 168 hours (7 days)'),
      ),
    auctionType: z.optional(z.union([z.literal('sealed'), z.literal('live')])),
    photoUrls: z.optional(z.array(z.url())),
  })
  .check(
    z.refine(
      (data) => {
        if (data.scheduleType === 'specific_date') {
          return !!data.scheduledDate;
        }
        return true;
      },
      {
        message: 'Scheduled date is required for specific date jobs',
        path: ['scheduledDate'],
      },
    ),
    z.refine(
      (data) => {
        if (data.isRecurring) {
          return !!data.recurrenceFrequency;
        }
        return true;
      },
      {
        message: 'Recurrence frequency is required for recurring jobs',
        path: ['recurrenceFrequency'],
      },
    ),
  );

export type JobPostingFormValues = z.infer<typeof jobPostingSchema>;

// Legal intake schema — a tight, legal-tailored alternative to the generic
// job-posting wizard. Maps onto the same CreateJobInput at submit time (the
// matter type IS a legal service category, so the created job lands in the
// legal vertical). Money is dollars in the form, converted to integer cents
// before the mutation (and re-validated server-side in the gateway).
export const LEGAL_URGENCY = ['urgent', 'soon', 'flexible'] as const;
export type LegalUrgency = (typeof LEGAL_URGENCY)[number];

export const LEGAL_CONTACT_PREFERENCE = ['platform', 'phone', 'video'] as const;
export type LegalContactPreference = (typeof LEGAL_CONTACT_PREFERENCE)[number];

export const legalIntakeSchema = z.object({
  // The matter type is a legal service category id (level-2 of the legal subtree).
  matterCategoryId: z.string().check(z.minLength(1, 'Select the type of legal help you need')),
  title: jobTitleSchema,
  description: jobDescriptionSchema,
  // 2-letter US state code — the jurisdiction the matter falls under.
  jurisdiction: z
    .string()
    .check(
      z.minLength(1, 'Select the state your matter is in'),
      z.maxLength(2, 'Use the 2-letter state code'),
    ),
  urgency: z.enum(LEGAL_URGENCY, {
    error: (issue) => (issue.input === undefined ? 'Choose a timeline' : undefined),
  }),
  // Budget is the customer's max — optional, positive whole dollars.
  budgetDollars: z.union([
    z.optional(
      z
        .number({ error: (issue) => (issue.input === undefined ? undefined : 'Enter a number') })
        .check(
          z.positive('Budget must be greater than $0'),
          z.maximum(1_000_000, 'Budget is too large'),
        ),
    ),
    zeroAsUndefined(),
  ]),
  contactPreference: z.enum(LEGAL_CONTACT_PREFERENCE, {
    error: (issue) => (issue.input === undefined ? 'Choose a contact preference' : undefined),
  }),
});

export type LegalIntakeFormValues = z.infer<typeof legalIntakeSchema>;
