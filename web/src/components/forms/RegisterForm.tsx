'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

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
import { OAuthButtons, OAuthDivider } from '@/components/auth/oauth-buttons';
import { registerSchema } from '@/lib/validations';
import { useAuthStore } from '@/stores/auth-store';

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const register = useAuthStore((s) => s.register);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      displayName: '',
    },
  });

  async function onSubmit(values: RegisterFormValues) {
    setFormError(null);
    try {
      await register(values.email, values.password, values.displayName);
      router.push('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      setFormError(message);
    }
  }

  const passwordValue = form.watch('password');

  function getPasswordStrength(password: string): {
    score: number;
    label: string;
    color: string;
  } {
    if (!password) return { score: 0, label: '', color: 'bg-border' };
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-destructive' };
    if (score <= 2) return { score: 2, label: 'Fair', color: 'bg-orange-400' };
    if (score <= 3) return { score: 3, label: 'Good', color: 'bg-yellow-400' };
    if (score <= 4) return { score: 4, label: 'Strong', color: 'bg-emerald-400' };
    return { score: 5, label: 'Very strong', color: 'bg-emerald-500' };
  }

  const strength = getPasswordStrength(passwordValue);

  return (
    <Card className="border-border/50 overflow-hidden shadow-xl shadow-black/5 backdrop-blur-sm">
      <div className="h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-bold tracking-tight">Create an account</CardTitle>
        <CardDescription>Enter your details below to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <OAuthButtons />
        <OAuthDivider />
        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="space-y-4"
            noValidate
          >
            {formError && (
              <div
                role="alert"
                aria-live="assertive"
                className="animate-auth-error bg-destructive/10 text-destructive rounded-md p-3 text-sm"
              >
                {formError}
              </div>
            )}

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input placeholder="Your name" autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Create a password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  {/* Password strength indicator */}
                  {passwordValue ? (
                    <div className="space-y-1 pt-1">
                      <div className="bg-border/50 h-1.5 w-full overflow-hidden rounded-full">
                        <div
                          className={`password-strength-bar h-full rounded-full ${strength.color}`}
                          style={{ width: `${(strength.score / 5) * 100}%` }}
                        />
                      </div>
                      <p className="text-muted-foreground text-xs">{strength.label}</p>
                    </div>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Confirm your password"
                      autoComplete="new-password"
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
              {form.formState.isSubmitting ? 'Creating account...' : 'Create account'}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="border-border/50 justify-center border-t pt-6">
        <p className="text-muted-foreground text-sm">
          Already have an account?{' '}
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
