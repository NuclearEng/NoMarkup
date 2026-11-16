// Sign-in, registration, password and MFA forms.
import * as z from '@/lib/zod-mini';

import { displayNameSchema, emailSchema, passwordSchema } from './common';

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
