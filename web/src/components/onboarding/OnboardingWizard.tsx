'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import {
  useEnableRole,
  useProfile,
  useSendPhoneOtp,
  useUpdateProfile,
  useVerifyPhone,
} from '@/hooks/useProfile';
import { useCreateProperty } from '@/hooks/useProperties';
import { USER_ROLE } from '@/types';

const STEPS = ['displayName', 'phone', 'address', 'provider', 'done'] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLE: Record<Step, string> = {
  displayName: 'Display name',
  phone: 'Phone',
  address: 'Service address',
  provider: 'Provider role',
  done: 'You’re set',
};

const STEP_PERCENT: Record<Step, number> = {
  displayName: 0,
  phone: 25,
  address: 50,
  provider: 75,
  done: 100,
};

function failureMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.userMessage(fallback);
  return fallback;
}

/**
 * Web match for iOS Finish setup. Every step except the summary can be
 * skipped. Not now returns to the dashboard; Account settings links back here.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const enableRole = useEnableRole();
  const sendOtp = useSendPhoneOtp();
  const verifyPhone = useVerifyPhone();
  const createProperty = useCreateProperty();

  const [step, setStep] = useState<Step>('displayName');
  const [bootstrapped, setBootstrapped] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [enableProvider, setEnableProvider] = useState(false);
  const [nickname, setNickname] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [propertySaved, setPropertySaved] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const profile = profileQuery.data;
  const hasProvider = profile?.roles.includes(USER_ROLE.PROVIDER) ?? false;

  useEffect(() => {
    if (!profile || bootstrapped) return;
    const name = profile.displayName ?? '';
    const existingPhone = profile.phone ?? '';
    setDisplayName(name);
    setPhone(existingPhone);
    const nameOk = name.trim().length > 0;
    const phoneOk = existingPhone.trim().length > 0;
    if (nameOk && phoneOk) setStep('address');
    else if (nameOk) setStep('phone');
    setBootstrapped(true);
  }, [profile, bootstrapped]);

  function clearMessages(): void {
    setErrorMessage(null);
    setStatusMessage(null);
  }

  function leave(): void {
    router.push('/dashboard' as Route);
  }

  async function saveDisplayName(): Promise<void> {
    clearMessages();
    const trimmed = displayName.trim();
    if (!trimmed) {
      setErrorMessage('Enter a display name.');
      return;
    }
    if (trimmed.length > 80) {
      setErrorMessage('Display name must be at most 80 characters.');
      return;
    }
    setBusy(true);
    try {
      await updateProfile.mutateAsync({ display_name: trimmed });
      setStatusMessage('Display name saved.');
      setStep('phone');
    } catch (err: unknown) {
      setErrorMessage(failureMessage(err, 'Could not save your display name.'));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(): Promise<void> {
    clearMessages();
    const trimmed = phone.trim();
    if (!trimmed) {
      setErrorMessage('Enter a phone number.');
      return;
    }
    setBusy(true);
    try {
      await updateProfile.mutateAsync({ phone: trimmed });
      await sendOtp.mutateAsync(trimmed);
      setOtpSent(true);
      setStatusMessage('Code sent. Enter it below, or skip and verify later.');
    } catch (err: unknown) {
      setErrorMessage(failureMessage(err, 'Could not send a verification code.'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(): Promise<void> {
    clearMessages();
    const code = otpCode.trim();
    if (!code) {
      setErrorMessage('Enter the SMS code.');
      return;
    }
    setBusy(true);
    try {
      await verifyPhone.mutateAsync(code);
      setStatusMessage('Phone verified.');
      setStep('address');
    } catch (err: unknown) {
      setErrorMessage(failureMessage(err, 'Could not verify that code.'));
    } finally {
      setBusy(false);
    }
  }

  async function continueFromPhone(): Promise<void> {
    clearMessages();
    const trimmed = phone.trim();
    const existing = (profile?.phone ?? '').trim();
    if (!trimmed || trimmed === existing) {
      setStep('address');
      return;
    }
    setBusy(true);
    try {
      await updateProfile.mutateAsync({ phone: trimmed });
      setStatusMessage('Phone saved. You can verify it later from Settings.');
      setStep('address');
    } catch (err: unknown) {
      setErrorMessage(failureMessage(err, 'Could not save that phone number.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveProperty(): Promise<void> {
    clearMessages();
    const state = stateCode.trim().toUpperCase();
    if (!nickname.trim() || !street.trim() || !city.trim() || state.length !== 2 || !zipCode.trim()) {
      setErrorMessage('Nickname, street, city, a 2-letter state, and ZIP are required.');
      return;
    }
    setBusy(true);
    try {
      await createProperty.mutateAsync({
        nickname: nickname.trim(),
        street: street.trim(),
        city: city.trim(),
        state,
        zip_code: zipCode.trim(),
      });
      setPropertySaved(nickname.trim());
      setStatusMessage(`Property “${nickname.trim()}” saved.`);
    } catch (err: unknown) {
      setErrorMessage(failureMessage(err, 'Could not save that address.'));
    } finally {
      setBusy(false);
    }
  }

  async function finishProvider(): Promise<void> {
    clearMessages();
    if (enableProvider && !hasProvider) {
      setBusy(true);
      try {
        await enableRole.mutateAsync('provider');
        setStatusMessage('Provider role enabled.');
        setStep('done');
      } catch (err: unknown) {
        setErrorMessage(failureMessage(err, 'Could not enable the provider role.'));
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep('done');
  }

  if (profileQuery.isLoading && !profile) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" role="status" data-testid="onboarding.loading">
          Loading profile…
        </p>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          data-testid="onboarding.notNow"
          onClick={leave}
        >
          Not now
        </Button>
      </div>
    );
  }

  if (profileQuery.isError && !profile) {
    return (
      <div className="space-y-3" data-testid="onboarding.error">
        <p role="alert" className="text-sm text-destructive">
          Couldn’t load your profile.
        </p>
        <Button
          type="button"
          className="min-h-11"
          onClick={() => {
            void profileQuery.refetch();
          }}
        >
          Try again
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          data-testid="onboarding.notNow"
          onClick={leave}
        >
          Not now
        </Button>
      </div>
    );
  }

  const optional = step === 'phone' || step === 'address' || step === 'provider';

  return (
    <div className="mx-auto max-w-lg space-y-6" data-testid="onboarding.root">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Finish setup</h1>
          <p className="text-sm text-muted-foreground">
            {STEP_TITLE[step]}. You can leave and come back from Settings.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 shrink-0"
          data-testid="onboarding.notNow"
          onClick={leave}
        >
          Not now
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-foreground">{STEP_TITLE[step]}</p>
          <p className="text-sm font-medium tabular-nums text-foreground">
            <span className="sr-only">Setup </span>
            {STEP_PERCENT[step]}%
          </p>
        </div>
        <progress
          className="h-2 w-full"
          max={100}
          value={STEP_PERCENT[step]}
          aria-label="Setup progress"
        />
        {optional ? (
          <p className="text-xs text-muted-foreground">Optional — you can skip and finish later.</p>
        ) : null}
      </div>

      {statusMessage ? (
        <p role="status" className="text-sm text-foreground">
          {statusMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {step === 'displayName' ? (
        <div className="space-y-3">
          <Label htmlFor="onboarding-display-name">Display name</Label>
          <Input
            id="onboarding-display-name"
            data-testid="onboarding.displayName"
            autoComplete="name"
            maxLength={80}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            At most 80 characters. Public on bids and chat.
          </p>
          <Button
            type="button"
            className="min-h-11 w-full"
            data-testid="onboarding.continue"
            disabled={busy || displayName.trim().length === 0}
            onClick={() => {
              void saveDisplayName();
            }}
          >
            Continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full"
            data-testid="onboarding.skip"
            disabled={busy}
            onClick={() => {
              clearMessages();
              setStep('phone');
            }}
          >
            Skip for now
          </Button>
        </div>
      ) : null}

      {step === 'phone' ? (
        <div className="space-y-3">
          <Label htmlFor="onboarding-phone">Phone number</Label>
          <Input
            id="onboarding-phone"
            data-testid="onboarding.phone"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
          {otpSent ? (
            <>
              <Label htmlFor="onboarding-otp">SMS code</Label>
              <Input
                id="onboarding-otp"
                data-testid="onboarding.otp"
                autoComplete="one-time-code"
                inputMode="numeric"
                value={otpCode}
                onChange={(event) => {
                  setOtpCode(event.target.value);
                }}
              />
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            data-testid="onboarding.sendOTP"
            disabled={busy || phone.trim().length === 0}
            onClick={() => {
              void sendCode();
            }}
          >
            {otpSent ? 'Resend SMS code' : 'Save phone and send SMS code'}
          </Button>
          {otpSent ? (
            <Button
              type="button"
              className="min-h-11 w-full"
              data-testid="onboarding.verifyOTP"
              disabled={busy || otpCode.trim().length === 0}
              onClick={() => {
                void verifyCode();
              }}
            >
              Verify code
            </Button>
          ) : null}
          <Button
            type="button"
            className="min-h-11 w-full"
            data-testid="onboarding.continue"
            disabled={busy}
            onClick={() => {
              void continueFromPhone();
            }}
          >
            Continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full"
            data-testid="onboarding.skip"
            disabled={busy}
            onClick={() => {
              clearMessages();
              setStep('address');
            }}
          >
            Skip phone
          </Button>
          <Link
            href={'/settings/security' as Route}
            className="inline-flex min-h-11 items-center text-sm text-foreground underline-offset-2 hover:underline"
          >
            Open security settings
          </Link>
        </div>
      ) : null}

      {step === 'address' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Save a home or site so reverse-auction jobs can reuse it. You can also manage
            addresses under Properties.
          </p>
          {propertySaved ? (
            <p role="status" className="text-sm text-foreground">
              Saved “{propertySaved}”
            </p>
          ) : null}
          <Label htmlFor="onboarding-nickname">Nickname</Label>
          <Input
            id="onboarding-nickname"
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
            }}
          />
          <Label htmlFor="onboarding-street">Street</Label>
          <Input
            id="onboarding-street"
            autoComplete="street-address"
            value={street}
            onChange={(event) => {
              setStreet(event.target.value);
            }}
          />
          <Label htmlFor="onboarding-city">City</Label>
          <Input
            id="onboarding-city"
            autoComplete="address-level2"
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="onboarding-state">State</Label>
              <Input
                id="onboarding-state"
                autoComplete="address-level1"
                maxLength={2}
                value={stateCode}
                onChange={(event) => {
                  setStateCode(event.target.value);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="onboarding-zip">ZIP</Label>
              <Input
                id="onboarding-zip"
                autoComplete="postal-code"
                value={zipCode}
                onChange={(event) => {
                  setZipCode(event.target.value);
                }}
              />
            </div>
          </div>
          <Button
            type="button"
            className="min-h-11 w-full"
            data-testid="onboarding.addProperty"
            disabled={busy}
            onClick={() => {
              void saveProperty();
            }}
          >
            Add property address
          </Button>
          <Link
            href={'/properties' as Route}
            className="inline-flex min-h-11 items-center text-sm text-foreground underline-offset-2 hover:underline"
          >
            Open Properties
          </Link>
          <Button
            type="button"
            className="min-h-11 w-full"
            data-testid="onboarding.continue"
            disabled={busy}
            onClick={() => {
              clearMessages();
              setStep('provider');
            }}
          >
            Continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full"
            data-testid="onboarding.skip"
            disabled={busy}
            onClick={() => {
              clearMessages();
              setStep('provider');
            }}
          >
            Skip address
          </Button>
        </div>
      ) : null}

      {step === 'provider' ? (
        <div className="space-y-3">
          {hasProvider ? (
            <p className="text-sm text-foreground">Provider role already enabled.</p>
          ) : (
            <label className="flex min-h-11 items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={enableProvider}
                onChange={(event) => {
                  setEnableProvider(event.target.checked);
                }}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Enable provider role</span>
                <span className="block text-xs text-muted-foreground">
                  Bid on service jobs and complete reverse-auction contracts. Admin cannot be
                  self-assigned.
                </span>
              </span>
            </label>
          )}
          <Button
            type="button"
            className="min-h-11 w-full"
            data-testid="onboarding.continue"
            disabled={busy}
            onClick={() => {
              void finishProvider();
            }}
          >
            {enableProvider && !hasProvider ? 'Enable and finish' : 'Finish'}
          </Button>
          {!hasProvider ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full"
              data-testid="onboarding.skip"
              disabled={busy}
              onClick={() => {
                clearMessages();
                setStep('done');
              }}
            >
              Skip — stay customer only
            </Button>
          ) : null}
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">Setup complete.</p>
          {profile?.displayName ? (
            <p className="text-sm text-muted-foreground">Signed in as {profile.displayName}</p>
          ) : null}
          {hasProvider || enableProvider ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Finish provider setup</p>
              <Link
                href={'/provider/workspace' as Route}
                className="block min-h-11 text-sm text-foreground underline-offset-2 hover:underline"
              >
                Provider workspace
              </Link>
              <Link
                href={'/provider/verification' as Route}
                className="block min-h-11 text-sm text-foreground underline-offset-2 hover:underline"
              >
                Verification documents
              </Link>
              <Link
                href={'/settings/payment-methods' as Route}
                className="block min-h-11 text-sm text-foreground underline-offset-2 hover:underline"
              >
                Stripe Connect payouts
              </Link>
            </div>
          ) : null}
          <Button
            type="button"
            className="min-h-11 w-full"
            data-testid="onboarding.done"
            onClick={leave}
          >
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}
