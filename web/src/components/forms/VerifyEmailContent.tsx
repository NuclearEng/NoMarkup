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
import { api } from '@/lib/api';
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
      setErrorMessage(
        error instanceof Error ? error.message : 'Verification failed',
      );
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
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Email Verification</CardTitle>
        <CardDescription>
          {state === 'loading' && 'Verifying your email address...'}
          {state === 'success' && 'Your email has been verified'}
          {state === 'error' && 'Verification failed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        {state === 'loading' && (
          <p className="text-sm text-muted-foreground">
            Please wait while we verify your email.
          </p>
        )}
        {state === 'success' && (
          <p className="text-sm text-muted-foreground">
            Your email address has been successfully verified. You can now sign
            in to your account.
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <Button asChild className="min-h-[44px]">
          <Link href="/login">Go to Sign In</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
