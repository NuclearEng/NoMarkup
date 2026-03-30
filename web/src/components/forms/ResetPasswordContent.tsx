'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { resetPasswordSchema } from '@/lib/validations';
import type { ResetPasswordFormValues } from '@/lib/validations';

export function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  if (!token) {
    return (
      <Card className="border border-[rgba(201,168,76,0.12)] bg-[#0c0f18] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="relative z-[2] h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
        <CardHeader className="relative z-[2] text-center">
          <CardTitle className="text-2xl text-white">Invalid reset link</CardTitle>
          <CardDescription className="text-white/65">
            This password reset link is invalid or has expired.
          </CardDescription>
        </CardHeader>
        <CardFooter className="relative z-[2] justify-center border-t border-white/10 pt-6">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-[var(--brand-gold)] underline-offset-4 hover:underline"
          >
            Request a new reset link
          </Link>
        </CardFooter>
      </Card>
    );
  }

  if (success) {
    return (
      <Card className="border border-[rgba(201,168,76,0.12)] bg-[#0c0f18] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="relative z-[2] h-[3px] bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400" />
        <CardHeader className="relative z-[2] text-center">
          <CardTitle className="text-2xl text-white">Password reset</CardTitle>
          <CardDescription className="text-white/65">
            Your password has been successfully reset. You can now sign in with your new password.
          </CardDescription>
        </CardHeader>
        <CardFooter className="relative z-[2] justify-center border-t border-white/10 pt-6">
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--brand-gold)] underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  async function onSubmit(values: ResetPasswordFormValues) {
    setFormError(null);
    try {
      await api.postUnauthed('/api/v1/auth/reset-password', {
        token,
        new_password: values.password,
      });
      setSuccess(true);
    } catch {
      setFormError('Failed to reset password. The link may have expired.');
    }
  }

  return (
    <Card className="border border-[rgba(201,168,76,0.12)] bg-[#0c0f18] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="relative z-[2] h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="relative z-[2] text-center">
        <CardTitle className="text-2xl text-white">Set new password</CardTitle>
        <CardDescription className="text-white/65">Enter your new password below</CardDescription>
      </CardHeader>
      <CardContent className="relative z-[2]">
        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="space-y-4"
            noValidate
          >
            {formError ? (
              <div
                role="alert"
                aria-live="assertive"
                className="glass-tinted-red text-destructive rounded-lg p-3 text-sm"
              >
                {formError}
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">New password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter new password"
                      autoComplete="new-password"
                      className="rounded-lg border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:border-[var(--brand-gold)]/50 focus:bg-white/[0.08]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Confirm password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      className="rounded-lg border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:border-[var(--brand-gold)]/50 focus:bg-white/[0.08]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="glass-cta-gold min-h-[44px] w-full rounded-lg font-semibold"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Resetting...' : 'Reset password'}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="relative z-[2] justify-center border-t border-white/10 pt-6">
        <p className="text-sm text-white/65">
          Remember your password?{' '}
          <Link
            href="/login"
            className="font-medium text-[var(--brand-gold)] underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
