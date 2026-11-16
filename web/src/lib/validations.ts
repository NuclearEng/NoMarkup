// Client bundles ship this module on ~20 routes, so it is written against
// `zod/mini` (standalone validator functions, tree-shakable) instead of the
// classic chained API (~25 kB gzip regardless of usage). Semantics, issue
// order and every error message are identical to the classic definitions:
// `x.min(n, m)` → `x.check(z.minLength(n, m))`, `x.optional()` →
// `z.optional(x)`, `a.or(b)` → `z.union([a, b])`, `x.refine(f, p)` →
// `x.check(z.refine(f, p))`, `x.transform(f)` → `z.pipe(x, z.transform(f))`.
import {
  CHAT_MESSAGE_RULE,
  PHONE_RULE,
  REVIEW_RESPONSE_RULE,
  REVISION_NOTES_RULE,
} from '@/lib/text-rules';
import * as z from '@/lib/zod-mini';

/** Optional field that also accepts '' (classic: `.optional().or(z.literal(''))`). */
function optionalOrEmpty<T extends z.ZodMiniType>(schema: T) {
  return z.union([z.optional(schema), z.literal('')]);
}

/** Integer 1–5 star rating. */
function starRating() {
  return z.number().check(z.int(), z.minimum(1), z.maximum(5));
}

/** Literal 0 mapped to `undefined` — an empty (0) amount counts as unset. */
function zeroAsUndefined() {
  return z.pipe(
    z.literal(0),
    z.transform(() => undefined),
  );
}

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

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().check(z.minLength(1, 'Password is required')),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().check(z.minLength(1, 'Please confirm your password')),
    displayName: displayNameSchema,
  })
  .check(
    z.refine((data) => data.password === data.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }),
  );

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

export const bidAmountSchema = z
  .number()
  .check(z.int('Amount must be in whole cents'), z.positive('Amount must be positive'));

export const reviewCommentSchema = z
  .string()
  .check(
    z.minLength(50, 'Review must be at least 50 characters'),
    z.maxLength(2000, 'Review must be at most 2000 characters'),
  );

export const ratingSchema = starRating();

// Profile schemas
export const timezoneSchema = z.string().check(z.minLength(1, 'Timezone is required'));

export const profileSchema = z.object({
  displayName: displayNameSchema,
  phone: optionalOrEmpty(phoneSchema),
  timezone: timezoneSchema,
  avatarUrl: optionalOrEmpty(z.url('Must be a valid URL')),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

// Provider schemas
export const businessInfoSchema = z.object({
  businessName: z
    .string()
    .check(
      z.minLength(2, 'Business name must be at least 2 characters'),
      z.maxLength(100, 'Business name must be at most 100 characters'),
    ),
  bio: optionalOrEmpty(z.string().check(z.maxLength(500, 'Bio must be at most 500 characters'))),
  serviceAddress: optionalOrEmpty(z.string()),
  einTin: optionalOrEmpty(
    z.string().check(z.regex(/^\d{2}-?\d{7}$/, 'EIN/TIN must be in XX-XXXXXXX format')),
  ),
  insuranceProvider: optionalOrEmpty(z.string().check(z.maxLength(200))),
  insurancePolicyNumber: optionalOrEmpty(z.string().check(z.maxLength(100))),
  insuranceExpiry: optionalOrEmpty(z.string()),
  insuranceCoverageDollars: z.optional(z.number().check(z.positive('Coverage must be positive'))),
});

export type BusinessInfoFormValues = z.infer<typeof businessInfoSchema>;

const milestoneSchema = z.object({
  description: z.string().check(z.minLength(1, 'Description is required')),
  percentage: z
    .number()
    .check(z.minimum(1, 'Must be at least 1%'), z.maximum(100, 'Must be at most 100%')),
});

export const globalTermsSchema = z
  .object({
    paymentTiming: z.enum(['upfront', 'milestone', 'completion', 'payment_plan', 'recurring'], {
      error: (issue) => (issue.input === undefined ? 'Payment timing is required' : undefined),
    }),
    milestones: z.optional(z.array(milestoneSchema)),
    cancellationPolicy: optionalOrEmpty(z.string()),
    warrantyTerms: optionalOrEmpty(z.string()),
  })
  .check(
    z.refine(
      (data) => {
        if (data.paymentTiming !== 'milestone') return true;
        if (!data.milestones || data.milestones.length === 0) return false;
        const sum = data.milestones.reduce((acc, m) => acc + m.percentage, 0);
        return sum === 100;
      },
      {
        message: 'Milestone percentages must sum to 100',
        path: ['milestones'],
      },
    ),
  );

export type GlobalTermsFormValues = z.infer<typeof globalTermsSchema>;

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

// Bid schemas
export const bidSchema = z.object({
  amountDollars: z.number().check(z.positive('Bid amount must be positive')),
});

export type BidFormValues = z.infer<typeof bidSchema>;

// Contract schemas
export const revisionNotesSchema = z.string().check(
  z.minLength(REVISION_NOTES_RULE.min, REVISION_NOTES_RULE.minMessage),
  // No custom message: the upper bound reports Zod's default text.
  z.maxLength(REVISION_NOTES_RULE.max),
);

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

// Chat schemas
export const chatMessageSchema = z
  .string()
  .check(
    z.minLength(CHAT_MESSAGE_RULE.min, CHAT_MESSAGE_RULE.minMessage),
    z.maxLength(CHAT_MESSAGE_RULE.max, CHAT_MESSAGE_RULE.maxMessage),
  );

// MFA schema
export const mfaCodeSchema = z
  .string()
  .check(
    z.minLength(6, 'Code must be at least 6 characters'),
    z.maxLength(8, 'Code must be at most 8 characters'),
  );

// Auth flow schemas
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .check(
    z.refine((data) => data.password === data.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }),
  );

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().check(z.minLength(1, 'Current password is required')),
    newPassword: passwordSchema,
    confirmNewPassword: z.string(),
  })
  .check(
    z.refine((data) => data.newPassword === data.confirmNewPassword, {
      message: 'Passwords do not match',
      path: ['confirmNewPassword'],
    }),
  );

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

// Property schemas — `street` is the form field; the API nests it inside
// `address: { street, city, state, zip_code, ... }`.
export const propertySchema = z.object({
  nickname: z.string().check(z.minLength(1, 'Nickname is required'), z.maxLength(100)),
  street: z.string().check(z.minLength(1, 'Street is required')),
  city: z.string().check(z.minLength(1, 'City is required')),
  state: z.string().check(z.minLength(1, 'State is required'), z.maxLength(2)),
  zip_code: z.string().check(z.regex(/^\d{5}(-\d{4})?$/, 'Invalid zip code')),
  notes: z.optional(z.string().check(z.maxLength(500))),
});

export type PropertyFormValues = z.infer<typeof propertySchema>;

// Listing (goods marketplace) schemas
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

// Employee schemas
export const addEmployeeSchema = z.object({
  firstName: z.string().check(z.minLength(1, 'First name is required'), z.maxLength(100)),
  lastName: z.string().check(z.minLength(1, 'Last name is required'), z.maxLength(100)),
  email: optionalOrEmpty(z.email('Invalid email')),
  phone: optionalOrEmpty(z.string()),
  dateOfBirth: optionalOrEmpty(z.string()),
  role: z.enum(['technician', 'lead', 'manager', 'apprentice'], {
    error: (issue) => (issue.input === undefined ? 'Role is required' : undefined),
  }),
  ssnLastFour: optionalOrEmpty(z.string().check(z.regex(/^\d{4}$/, 'Must be exactly 4 digits'))),
  licenseNumber: optionalOrEmpty(z.string()),
  licenseState: optionalOrEmpty(z.string()),
  licenseExpiry: optionalOrEmpty(z.string()),
  insurancePolicyNumber: optionalOrEmpty(z.string()),
  insuranceExpiry: optionalOrEmpty(z.string()),
});

export type AddEmployeeFormValues = z.infer<typeof addEmployeeSchema>;
