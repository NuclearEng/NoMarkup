'use client';

import { useRef, useState } from 'react';
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
import { getApiErrorMessage } from '@/lib/api';
import { loginSchema } from '@/lib/validations';
import { useAuthStore, MFARequiredError } from '@/stores/auth-store';

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const completeMFALogin = useAuthStore((s) => s.completeMFALogin);
  const [formError, setFormError] = useState<string | null>(null);
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const totpInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
  });

  async function onSubmit(values: LoginFormValues) {
    setFormError(null);
    try {
      await login(values.email, values.password);
      router.push('/dashboard');
    } catch (error) {
      if (error instanceof MFARequiredError) {
        setMfaChallengeToken(error.challengeToken);
        setMfaStep(true);
        // Focus the TOTP input after render.
        setTimeout(() => totpInputRef.current?.focus(), 100);
        return;
      }
      setFormError(getApiErrorMessage(error, 'Login failed'));
    }
  }

  async function onMFASubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setFormError(null);
    setMfaSubmitting(true);
    try {
      await completeMFALogin(mfaChallengeToken, totpCode);
      router.push('/dashboard');
    } catch (error) {
      setFormError(getApiErrorMessage(error, 'Invalid verification code'));
    } finally {
      setMfaSubmitting(false);
    }
  }

  if (mfaStep) {
    return (
      <Card className="border border-[rgba(201,168,76,0.12)] bg-[#14161e] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="relative z-[2] h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
        <CardHeader className="relative z-[2] text-center">
          <CardTitle className="text-2xl font-bold tracking-tight text-white">
            Two-factor authentication
          </CardTitle>
          <CardDescription className="text-white/65">
            Enter the 6-digit code from your authenticator app, or use a backup code
          </CardDescription>
        </CardHeader>
        <CardContent className="relative z-[2]">
          <form onSubmit={(e) => void onMFASubmit(e)} className="space-y-4">
            {formError ? (
              <div
                role="alert"
                aria-live="assertive"
                className="glass-tinted-red animate-auth-error text-destructive rounded-lg p-3 text-sm"
              >
                {formError}
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="totp-code" className="text-sm leading-none font-medium text-white/80">
                Verification code
              </label>
              <Input
                ref={totpInputRef}
                id="totp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={8}
                value={totpCode}
                onChange={(e) => { setTotpCode(e.target.value); }}
                className="rounded-lg border-white/10 bg-white/5 text-center text-lg tracking-widest text-white placeholder:text-white/40 focus:border-[var(--brand-gold)]/50 focus:bg-white/[0.08]"
              />
              <p className="text-xs text-white/60">You can also enter a backup code</p>
            </div>

            <Button
              type="submit"
              className="glass-cta-gold min-h-[44px] w-full rounded-lg font-semibold"
              disabled={mfaSubmitting || totpCode.length < 6}
            >
              {mfaSubmitting ? 'Verifying...' : 'Verify'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] w-full text-white/60 hover:text-white"
              onClick={() => {
                setMfaStep(false);
                setTotpCode('');
                setFormError(null);
              }}
            >
              Back to login
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-[rgba(201,168,76,0.12)] bg-[#14161e] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="relative z-[2] h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="relative z-[2] text-center">
        <CardTitle className="text-3xl font-bold tracking-tight text-white">Welcome back</CardTitle>
        <CardDescription className="text-sm text-white/65">
          Sign in — the market sets the price, not the markup.
        </CardDescription>
      </CardHeader>
      <CardContent className="relative z-[2]">
        <OAuthButtons />
        <OAuthDivider />
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

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      className="rounded-lg border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:border-[var(--brand-gold)]/50 focus:bg-white/[0.08]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex min-h-[44px] items-center justify-between">
              <FormField
                control={form.control}
                name="rememberMe"
                render={({ field }) => (
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={field.onChange}
                      aria-label="Remember me"
                      className="h-5 w-5 rounded border-white/20 bg-white/5 accent-[var(--brand-gold)]"
                    />
                    <span className="text-sm text-white/65">Remember me</span>
                  </label>
                )}
              />
              <Link
                href="/forgot-password"
                className="flex min-h-[44px] items-center text-sm font-medium text-white/65 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              className="glass-cta-gold min-h-[44px] w-full rounded-lg font-semibold"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="relative z-[2] flex-col gap-3 border-t border-white/10 pt-6">
        <p className="text-center text-sm text-white/65">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-[var(--brand-gold)] underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
        <p className="text-center text-xs text-white/45">
          <Link href="/privacy" className="underline-offset-4 hover:text-white/70 hover:underline">
            Privacy
          </Link>
          {' · '}
          <Link href="/terms" className="underline-offset-4 hover:text-white/70 hover:underline">
            Terms
          </Link>
          {' · '}
          <Link href="/support" className="underline-offset-4 hover:text-white/70 hover:underline">
            Support
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
