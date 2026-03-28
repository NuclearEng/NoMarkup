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
      <Card className="border-border/50 overflow-hidden shadow-xl shadow-black/5 backdrop-blur-sm">
        <div className="h-[3px] bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400" />
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-emerald-600 dark:text-emerald-400"
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
          <CardTitle className="text-2xl font-bold tracking-tight">Check your email</CardTitle>
          <CardDescription className="leading-relaxed">
            If an account exists with that email address, we sent a password reset link. Check your
            inbox and follow the instructions.
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-border/50 justify-center border-t pt-6">
          <Link
            href="/login"
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 overflow-hidden shadow-xl shadow-black/5 backdrop-blur-sm">
      <div className="h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">Forgot your password?</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a reset link</CardDescription>
      </CardHeader>
      <CardContent>
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
                className="animate-auth-error bg-destructive/10 text-destructive rounded-md p-3 text-sm"
              >
                {formError}
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="min-h-[44px] w-full bg-[var(--brand-gold)] font-semibold text-white shadow-[var(--brand-gold)]/20 shadow-md transition-all hover:bg-[var(--brand-gold-bright)] hover:shadow-[var(--brand-gold)]/25 hover:shadow-lg"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="border-border/50 justify-center border-t pt-6">
        <p className="text-muted-foreground text-sm">
          Remember your password?{' '}
          <Link
            href="/login"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
