'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Briefcase, Wrench } from 'lucide-react';
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
import { useEnableRole } from '@/hooks/useProfile';
import { api, getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { registerSchema } from '@/lib/validations';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const register = useAuthStore((s) => s.register);
  const enableRole = useEnableRole();
  const [formError, setFormError] = useState<string | null>(null);
  const [intent, setIntent] = useState<'customer' | 'provider'>('customer');

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      displayName: '',
    },
  });

  // A referral code arrives via the share link (/register?ref=CODE). After a
  // successful registration the new account is authenticated, so we redeem the
  // code to attribute the referral. Best-effort: a bad/expired code or a
  // network blip must never block account creation, so failures are swallowed.
  async function attributeReferral() {
    if (typeof window === 'undefined') return;
    const code = new URLSearchParams(window.location.search).get('ref')?.trim();
    if (!code) return;
    try {
      await api.post('/api/v1/me/referrals/redeem', { code: code.toUpperCase() });
    } catch {
      // Non-fatal: the user can still redeem manually from /me/referrals.
    }
  }

  async function onSubmit(values: RegisterFormValues) {
    setFormError(null);
    try {
      await register(values.email, values.password, values.displayName);
      await attributeReferral();
      if (intent === 'provider') {
        await enableRole.mutateAsync(USER_ROLE.PROVIDER);
        router.push('/provider/onboarding');
      } else {
        router.push('/dashboard');
      }
    } catch (error) {
      setFormError(getApiErrorMessage(error, 'Registration failed'));
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
    <Card className="border border-[rgba(201,168,76,0.12)] bg-[#0c0f18] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="relative z-[2] h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="relative z-[2] text-center">
        <CardTitle className="text-3xl font-bold tracking-tight text-white">
          Create an account
        </CardTitle>
        <CardDescription className="text-white/65">
          Enter your details below to get started
        </CardDescription>
      </CardHeader>
      <CardContent className="relative z-[2]">
        {/* Role intent picker */}
        <div className="mb-5 grid grid-cols-2 gap-3" role="group" aria-label="Account type">
          <button
            type="button"
            onClick={() => { setIntent('customer'); }}
            aria-pressed={intent === 'customer'}
            className={cn(
              'rounded-lg border p-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60',
              intent === 'customer'
                ? 'border-[var(--brand-gold)]/60 bg-[var(--brand-gold)]/[0.07]'
                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
            )}
          >
            <Briefcase
              className={cn('mb-2 h-5 w-5', intent === 'customer' ? 'text-[var(--brand-gold)]' : 'text-white/40')}
              aria-hidden="true"
            />
            <p className="text-sm font-semibold text-white">I need work done</p>
            <p className="mt-0.5 text-xs text-white/50">Hire skilled providers</p>
          </button>
          <button
            type="button"
            onClick={() => { setIntent('provider'); }}
            aria-pressed={intent === 'provider'}
            className={cn(
              'rounded-lg border p-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60',
              intent === 'provider'
                ? 'border-[var(--brand-gold)]/60 bg-[var(--brand-gold)]/[0.07]'
                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
            )}
          >
            <Wrench
              className={cn('mb-2 h-5 w-5', intent === 'provider' ? 'text-[var(--brand-gold)]' : 'text-white/40')}
              aria-hidden="true"
            />
            <p className="text-sm font-semibold text-white">I offer services</p>
            <p className="mt-0.5 text-xs text-white/50">Grow your business</p>
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-white/50">
          Pick your main goal — you can do both, and add the other anytime from your profile.
        </p>

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
                className="glass-tinted-red animate-auth-error text-destructive rounded-lg p-3 text-sm"
              >
                {formError}
              </div>
            )}

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Display name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Your name"
                      autoComplete="name"
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

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Create a password"
                      autoComplete="new-password"
                      className="rounded-lg border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:border-[var(--brand-gold)]/50 focus:bg-white/[0.08]"
                      {...field}
                    />
                  </FormControl>
                  {/* Password strength indicator */}
                  {passwordValue ? (
                    <div className="space-y-1 pt-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`password-strength-bar h-full rounded-full ${strength.color}`}
                          style={{ width: `${String((strength.score / 5) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-white/60">{strength.label}</p>
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
                  <FormLabel className="text-white/80">Confirm password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Confirm your password"
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
              disabled={form.formState.isSubmitting || enableRole.isPending}
            >
              {form.formState.isSubmitting || enableRole.isPending
                ? 'Creating account...'
                : intent === 'provider'
                  ? 'Create provider account'
                  : 'Create account'}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="relative z-[2] justify-center border-t border-white/10 pt-6">
        <p className="text-sm text-white/65">
          Already have an account?{' '}
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
