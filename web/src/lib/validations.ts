import { z } from 'zod';

export const emailSchema = z.string().email('Invalid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const displayNameSchema = z
  .string()
  .min(2, 'Display name must be at least 2 characters')
  .max(100, 'Display name must be at most 100 characters');

export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number');

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    displayName: displayNameSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const jobTitleSchema = z
  .string()
  .min(10, 'Title must be at least 10 characters')
  .max(200, 'Title must be at most 200 characters');

export const jobDescriptionSchema = z
  .string()
  .min(50, 'Description must be at least 50 characters')
  .max(5000, 'Description must be at most 5000 characters');

export const bidAmountSchema = z
  .number()
  .int('Amount must be in whole cents')
  .positive('Amount must be positive');

export const reviewCommentSchema = z
  .string()
  .min(50, 'Review must be at least 50 characters')
  .max(2000, 'Review must be at most 2000 characters');

export const ratingSchema = z.number().int().min(1).max(5);

// Profile schemas
export const timezoneSchema = z.string().min(1, 'Timezone is required');

export const profileSchema = z.object({
  displayName: displayNameSchema,
  phone: phoneSchema.optional().or(z.literal('')),
  timezone: timezoneSchema,
  avatarUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

// Provider schemas
export const businessInfoSchema = z.object({
  businessName: z
    .string()
    .min(2, 'Business name must be at least 2 characters')
    .max(100, 'Business name must be at most 100 characters'),
  bio: z.string().max(500, 'Bio must be at most 500 characters').optional().or(z.literal('')),
  serviceAddress: z.string().optional().or(z.literal('')),
});

export type BusinessInfoFormValues = z.infer<typeof businessInfoSchema>;

const milestoneSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  percentage: z.number().min(1, 'Must be at least 1%').max(100, 'Must be at most 100%'),
});

export const globalTermsSchema = z
  .object({
    paymentTiming: z.enum(['upfront', 'milestone', 'completion', 'payment_plan', 'recurring'], {
      required_error: 'Payment timing is required',
    }),
    milestones: z.array(milestoneSchema).optional(),
    cancellationPolicy: z.string().optional().or(z.literal('')),
    warrantyTerms: z.string().optional().or(z.literal('')),
  })
  .refine(
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
  );

export type GlobalTermsFormValues = z.infer<typeof globalTermsSchema>;

// Job posting schema
export const jobPostingSchema = z
  .object({
    categoryId: z.string().min(1, 'Category is required'),
    title: jobTitleSchema,
    description: jobDescriptionSchema,
    scheduleType: z.union(
      [z.literal('specific_date'), z.literal('date_range'), z.literal('flexible')],
      { required_error: 'Schedule type is required' },
    ),
    scheduledDate: z.string().optional(),
    isRecurring: z.boolean(),
    recurrenceFrequency: z
      .union([
        z.literal('weekly'),
        z.literal('biweekly'),
        z.literal('monthly'),
        z.literal('quarterly'),
      ])
      .optional(),
    locationAddress: z.string().optional(),
    locationLat: z.number().optional(),
    locationLng: z.number().optional(),
    startingBidDollars: z
      .number()
      .positive('Starting bid must be positive')
      .optional()
      .or(z.literal(0).transform(() => undefined)),
    offerAcceptedDollars: z
      .number()
      .positive('Accepted offer must be positive')
      .optional()
      .or(z.literal(0).transform(() => undefined)),
    auctionDurationHours: z
      .number()
      .int('Duration must be a whole number')
      .min(24, 'Minimum auction duration is 24 hours')
      .max(168, 'Maximum auction duration is 168 hours (7 days)'),
  })
  .refine(
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
  )
  .refine(
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
  );

export type JobPostingFormValues = z.infer<typeof jobPostingSchema>;

// Bid schemas
export const bidSchema = z.object({
  amountDollars: z.number().positive('Bid amount must be positive'),
});

export type BidFormValues = z.infer<typeof bidSchema>;

// Contract schemas
export const revisionNotesSchema = z.string().min(10, 'Revision notes must be at least 10 characters').max(2000);
