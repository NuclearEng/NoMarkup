// Provider onboarding (business info, terms) and team management.
import * as z from '@/lib/zod-mini';

import { optionalOrEmpty } from './_helpers';

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
