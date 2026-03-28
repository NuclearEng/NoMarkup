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
      const message = error instanceof Error ? error.message : 'Login failed';
      setFormError(message);
    }
  }

  async function onMFASubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setMfaSubmitting(true);
    try {
      await completeMFALogin(mfaChallengeToken, totpCode);
      router.push('/dashboard');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid verification code';
      setFormError(message);
    } finally {
      setMfaSubmitting(false);
    }
  }

  if (mfaStep) {
    return (
      <Card className="border-border/50 overflow-hidden shadow-xl shadow-black/5 backdrop-blur-sm">
        <div className="h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app, or use a backup code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onMFASubmit(e)} className="space-y-4">
            {formError ? (
              <div
                role="alert"
                aria-live="assertive"
                className="animate-auth-error bg-destructive/10 text-destructive rounded-md p-3 text-sm"
              >
                {formError}
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="totp-code" className="text-sm leading-none font-medium">
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
                onChange={(e) => setTotpCode(e.target.value)}
                className="text-center text-lg tracking-widest"
              />
              <p className="text-muted-foreground text-xs">You can also enter a backup code</p>
            </div>

            <Button
              type="submit"
              className="min-h-[44px] w-full bg-[var(--brand-gold)] font-semibold text-white shadow-[var(--brand-gold)]/20 shadow-md transition-all hover:bg-[var(--brand-gold-bright)] hover:shadow-[var(--brand-gold)]/25 hover:shadow-lg"
              disabled={mfaSubmitting || totpCode.length < 6}
            >
              {mfaSubmitting ? 'Verifying...' : 'Verify'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] w-full"
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
    <Card className="border-border/50 overflow-hidden shadow-xl shadow-black/5 backdrop-blur-sm">
      <div className="h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-bold tracking-tight">Welcome back</CardTitle>
        <CardDescription className="text-sm">Sign in to your account</CardDescription>
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

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter your password"
                      autoComplete="current-password"
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
                  <label className="flex cursor-pointer items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={field.onChange}
                      className="border-input accent-primary h-4 w-4 rounded"
                    />
                    <span className="text-muted-foreground text-sm">Remember me</span>
                  </label>
                )}
              />
              <Link
                href="/forgot-password"
                className="text-muted-foreground hover:text-foreground flex min-h-[44px] items-center text-sm font-medium underline-offset-4 transition-colors hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              className="min-h-[44px] w-full bg-[var(--brand-gold)] font-semibold text-white shadow-[var(--brand-gold)]/20 shadow-md transition-all hover:bg-[var(--brand-gold-bright)] hover:shadow-[var(--brand-gold)]/25 hover:shadow-lg"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="border-border/50 justify-center border-t pt-6">
        <p className="text-muted-foreground text-sm">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
