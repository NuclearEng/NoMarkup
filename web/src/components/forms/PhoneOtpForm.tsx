'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSendPhoneOtp, useVerifyPhone } from '@/hooks/useProfile';
import { phoneSchema } from '@/lib/validations';

export interface PhoneOtpFormProps {
  /** Prefill from GET /users/me when the caller already saved a number. */
  initialPhone?: string | null;
  phoneVerified?: boolean;
}

export function PhoneOtpForm({ initialPhone, phoneVerified = false }: PhoneOtpFormProps) {
  const sendOtp = useSendPhoneOtp();
  const verifyPhone = useVerifyPhone();

  const [phone, setPhone] = useState(initialPhone?.trim() ?? '');
  const [otpCode, setOtpCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  const verified = phoneVerified || verifyPhone.data?.verified === true;
  const busy = sendOtp.isPending || verifyPhone.isPending;
  const phoneTrim = phone.trim();
  const otpTrim = otpCode.trim();

  async function handleSend() {
    setPhoneError(null);
    const parsed = phoneSchema.safeParse(phoneTrim);
    if (!parsed.success) {
      setPhoneError(parsed.error.issues[0]?.message ?? 'Invalid phone number');
      return;
    }
    try {
      await sendOtp.mutateAsync(parsed.data);
      setCodeSent(true);
    } catch {
      // Toast comes from the hook.
    }
  }

  async function handleVerify() {
    setOtpError(null);
    if (otpTrim.length === 0) {
      setOtpError('OTP code is required');
      return;
    }
    try {
      await verifyPhone.mutateAsync(otpTrim);
      setOtpCode('');
    } catch {
      // Toast comes from the hook.
    }
  }

  return (
    <div className="space-y-4" data-testid="phone-otp-form">
      {verified ? (
        <p className="text-sm text-emerald-400" role="status">
          Phone verified.
        </p>
      ) : (
        <p className="text-sm text-zinc-400">
          Verify a phone number with an SMS code before posting jobs or transacting.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="phone-otp-phone">Phone (E.164 preferred)</Label>
        <Input
          id="phone-otp-phone"
          type="tel"
          autoComplete="tel"
          placeholder="+15551234567"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPhoneError(null);
          }}
          aria-invalid={phoneError !== null}
          aria-describedby={phoneError ? 'phone-otp-phone-error' : undefined}
          className="min-h-[44px]"
        />
        {phoneError ? (
          <p id="phone-otp-phone-error" role="alert" className="text-destructive text-sm">
            {phoneError}
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        variant="outline"
        className="min-h-[44px]"
        disabled={busy || phoneTrim.length === 0}
        onClick={() => {
          void handleSend();
        }}
      >
        {sendOtp.isPending ? 'Sending…' : 'Send SMS code'}
      </Button>

      <div className="space-y-2">
        <Label htmlFor="phone-otp-code">OTP code</Label>
        <Input
          id="phone-otp-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          value={otpCode}
          onChange={(e) => {
            setOtpCode(e.target.value);
            setOtpError(null);
          }}
          aria-invalid={otpError !== null}
          aria-describedby={otpError ? 'phone-otp-code-error' : undefined}
          className="min-h-[44px]"
        />
        {otpError ? (
          <p id="phone-otp-code-error" role="alert" className="text-destructive text-sm">
            {otpError}
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        className="min-h-[44px]"
        disabled={busy || otpTrim.length === 0 || (!codeSent && !verified)}
        onClick={() => {
          void handleVerify();
        }}
      >
        {verifyPhone.isPending ? 'Verifying…' : 'Verify phone'}
      </Button>
    </div>
  );
}
