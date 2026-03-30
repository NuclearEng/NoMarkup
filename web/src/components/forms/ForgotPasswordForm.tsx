'use client';

import Link from 'next/link';
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
import { forgotPasswordSchema } from '@/lib/validations';
import type { ForgotPasswordFormValues } from '@/lib/validations';

export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    setFormError(null);
    try {
      await api.postUnauthed('/api/v1/auth/forgot-password', {
        email: values.email,
      });
      setSubmitted(true);
    } catch {
      setFormError('Failed to send reset link. Please try again.');
    }
  }

  if (submitted) {
    return (
      <Card className="border border-[rgba(201,168,76,0.12)] bg-[#0c0f18] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="relative z-[2] h-[3px] bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400" />
        <CardHeader className="relative z-[2] text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-white">
            Check your email
          </CardTitle>
          <CardDescription className="leading-relaxed text-white/65">
            If an account exists with that email address, we sent a password reset link. Check your
            inbox and follow the instructions.
          </CardDescription>
        </CardHeader>
        <CardFooter className="relative z-[2] justify-center border-t border-white/10 pt-6">
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--brand-gold)] underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border border-[rgba(201,168,76,0.12)] bg-[#0c0f18] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="relative z-[2] h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="relative z-[2] text-center">
        <CardTitle className="text-2xl font-bold tracking-tight text-white">
          Forgot your password?
        </CardTitle>
        <CardDescription className="text-white/65">
          Enter your email and we&apos;ll send you a reset link
        </CardDescription>
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
                className="glass-tinted-red animate-auth-error text-destructive rounded-lg p-3 text-sm"
              >
                {formError}
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
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
              {form.formState.isSubmitting ? 'Sending...' : 'Send reset link'}
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
