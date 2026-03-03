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
