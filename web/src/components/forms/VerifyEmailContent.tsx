'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { api, getApiErrorMessage } from '@/lib/api';
import type { VerifyEmailResponse } from '@/types';

type VerifyState = 'loading' | 'success' | 'error';

export function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<VerifyState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const verify = useCallback(async (verifyToken: string) => {
    try {
      await api.postUnauthed<VerifyEmailResponse>(
        `/api/v1/auth/verify-email?token=${encodeURIComponent(verifyToken)}`,
      );
      setState('success');
    } catch (error) {
      setState('error');
      setErrorMessage(getApiErrorMessage(error, 'Verification failed'));
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMessage('No verification token provided');
      return;
    }
    void verify(token);
  }, [token, verify]);

  return (
    <Card className="border border-[rgba(201,168,76,0.12)] bg-[#0c0f18] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="relative z-[2] h-[3px] bg-gradient-to-r from-[var(--brand-gold-dim)] via-[var(--brand-gold)] to-[var(--brand-gold-bright)]" />
      <CardHeader className="relative z-[2] text-center">
        <CardTitle className="text-2xl text-white">Email Verification</CardTitle>
        <CardDescription className="text-white/65">
          {state === 'loading' && 'Verifying your email address...'}
          {state === 'success' && 'Your email has been verified'}
          {state === 'error' && 'Verification failed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="relative z-[2] text-center">
        {state === 'loading' && (
          <p className="text-sm text-white/65">Please wait while we verify your email.</p>
        )}
        {state === 'success' && (
          <p className="text-sm text-white/65">
            Your email address has been successfully verified. You can now sign in to your account.
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage}
          </p>
        )}
      </CardContent>
      <CardFooter className="relative z-[2] justify-center border-t border-white/10 pt-6">
        <Button asChild className="glass-cta-gold min-h-[44px] rounded-lg">
          <Link href="/login">Go to Sign In</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
