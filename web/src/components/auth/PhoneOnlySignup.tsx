'use client';

/**
 * PhoneOnlySignup — phone + OTP signup card.
 *
 * Two-step UI:
 *   1. User enters their phone in E.164 (we validate client-side and
 *      surface a polite error before round-tripping).
 *   2. We POST to /api/v1/auth/send-phone-otp with the phone (anonymous
 *      OTP send is allowed by design); the user enters the 6-digit code,
 *      we POST to /api/v1/auth/register-phone with both, the gateway
 *      creates the user + verifies + returns a token pair, and the
 *      caller's onSuccess fires.
 *
 * The component is presentation-only — caller wires up the post-signup
 * navigation (typically `/onboarding`).
 */

import { useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setAccessToken } from '@/lib/auth';
import type { TokenPair } from '@/types';

interface PhoneOnlySignupProps {
  /** Called after a successful signup. The token pair is already cached
   *  via setAccessToken — the caller typically just navigates. */
  onSuccess: (token: TokenPair) => void;
  className?: string;
}

const E164_RE = /^\+[1-9]\d{7,14}$/;

export function PhoneOnlySignup({ onSuccess, className }: PhoneOnlySignupProps) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);
    if (!E164_RE.test(phone.trim())) {
      setError('Please enter your phone in E.164 format (e.g. +15551234567).');
      return;
    }
    setBusy(true);
    try {
      // The anonymous send-phone-otp endpoint is the same handler as the
      // logged-in send-phone-otp; the gateway accepts unauthenticated
      // calls when the body provides a phone in lieu of a session.
      await api.post('/api/v1/auth/send-phone-otp', { phone: phone.trim() });
      setStep('otp');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.userMessage('Could not send a verification code.'));
      } else {
        setError('Could not send a verification code.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndRegister(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);
    if (otp.trim().length < 4) {
      setError('Enter the code we sent to your phone.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<TokenPair & { user_id: string }>(
        '/api/v1/auth/register-phone',
        { phone: phone.trim(), otp_code: otp.trim() },
      );
      setAccessToken(result.access_token);
      onSuccess(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.userMessage('Could not verify your code.'));
      } else {
        setError('Could not verify your code.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === 'phone') {
    return (
      <form
        onSubmit={(e) => {
          void sendCode(e);
        }}
        className={className}
        aria-label="Sign up with phone"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="phone-only-phone">Phone number</Label>
            <Input
              id="phone-only-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="+15551234567"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
              }}
              className="min-h-[44px]"
              aria-invalid={error !== null}
              aria-describedby={error !== null ? 'phone-only-error' : undefined}
            />
          </div>
          {error !== null ? (
            <p id="phone-only-error" role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy} className="min-h-[44px] w-full">
            {busy ? 'Sending code…' : 'Send verification code'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void verifyAndRegister(e);
      }}
      className={className}
      aria-label="Verify phone code"
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="phone-only-otp">Enter the 6-digit code we sent to {phone}</Label>
          <Input
            id="phone-only-otp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={8}
            required
            value={otp}
            onChange={(e) => {
              setOtp(e.target.value.replace(/[^0-9]/g, ''));
            }}
            className="min-h-[44px] tracking-widest"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? 'phone-only-otp-error' : undefined}
          />
        </div>
        {error !== null ? (
          <p id="phone-only-otp-error" role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setStep('phone');
              setOtp('');
              setError(null);
            }}
            className="min-h-[44px]"
          >
            Change phone
          </Button>
          <Button type="submit" disabled={busy} className="min-h-[44px] flex-1">
            {busy ? 'Verifying…' : 'Create account'}
          </Button>
        </div>
      </div>
    </form>
  );
}
