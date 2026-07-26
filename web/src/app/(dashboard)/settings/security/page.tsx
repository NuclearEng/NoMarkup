'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Shield, Smartphone, Copy, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getApiErrorMessage } from '@/lib/api';
import { changePasswordSchema } from '@/lib/validations';
import type { ChangePasswordFormValues } from '@/lib/validations';
import { ConnectedAccounts } from '@/components/settings/ConnectedAccounts';
import { useProfile } from '@/hooks/useProfile';
import {
  useEnableMFA,
  useVerifyMFASetup,
  useDisableMFA,
} from '@/hooks/useMFA';

function MFASection() {
  const { data: profile, isLoading } = useProfile();
  const enableMFA = useEnableMFA();
  const verifySetup = useVerifyMFASetup();
  const disableMFA = useDisableMFA();

  const [setupData, setSetupData] = useState<{
    secret: string;
    qr_code_url: string;
    backup_codes: string[];
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text flex items-center gap-2 text-lg">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
            Two-Factor Authentication
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const mfaEnabled = profile?.mfaEnabled ?? false;

  async function handleEnableMFA() {
    setError(null);
    setSuccess(null);
    try {
      const data = await enableMFA.mutateAsync();
      setSetupData(data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to start MFA setup'));
    }
  }

  async function handleVerifySetup() {
    if (!setupData) return;
    setError(null);
    try {
      await verifySetup.mutateAsync({
        totp_code: verifyCode,
        backup_codes: setupData.backup_codes,
      });
      setSetupData(null);
      setVerifyCode('');
      setSuccess('Two-factor authentication has been enabled.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Invalid verification code'));
    }
  }

  async function handleDisableMFA() {
    setError(null);
    try {
      await disableMFA.mutateAsync({ totp_code: disableCode });
      setShowDisable(false);
      setDisableCode('');
      setSuccess('Two-factor authentication has been disabled.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Invalid verification code'));
    }
  }

  function handleCopyBackupCodes() {
    if (!setupData) return;
    void navigator.clipboard.writeText(setupData.backup_codes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => { setCopiedCodes(false); }, 2000);
  }

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text flex items-center gap-2 text-lg">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
          Two-Factor Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            role="status"
            className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
          >
            {success}
          </div>
        ) : null}

        {/* Setup flow */}
        {setupData ? (
          <div className="max-w-md space-y-4">
            <p className="text-sm text-zinc-300">
              Scan this QR code with your authenticator app (Google
              Authenticator, Authy, 1Password, etc.), then enter the 6-digit
              code below to confirm.
            </p>

            {/* QR code via otpauth URI rendered as an image */}
            <div className="flex justify-center rounded-lg border bg-white p-4">
              {/* QR code from external API — using img intentionally, not next/image */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.qr_code_url)}`}
                alt="Scan this QR code with your authenticator app"
                width={200}
                height={200}
              />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-zinc-300">
                Manual entry key
              </p>
              <code className="block break-all rounded bg-muted p-2 font-mono text-sm">
                {setupData.secret}
              </code>
            </div>

            <div className="glass-divider" role="separator" />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Backup codes</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] gap-2"
                  onClick={handleCopyBackupCodes}
                >
                  {copiedCodes ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      Copy all
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-zinc-300">
                Save these codes in a safe place. Each code can only be used
                once.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/50 p-3">
                {setupData.backup_codes.map((code) => (
                  <code key={code} className="font-mono text-sm">
                    {code}
                  </code>
                ))}
              </div>
            </div>

            <div className="glass-divider" role="separator" />

            <div className="space-y-2">
              <label
                htmlFor="verify-totp"
                className="text-sm font-medium leading-none"
              >
                Enter code to verify
              </label>
              <Input
                id="verify-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => { setVerifyCode(e.target.value); }}
                className="max-w-[200px] text-center text-lg tracking-widest"
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={verifyCode.length < 6 || verifySetup.isPending}
                onClick={() => void handleVerifySetup()}
              >
                {verifySetup.isPending ? 'Verifying...' : 'Enable MFA'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => {
                  setSetupData(null);
                  setVerifyCode('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : mfaEnabled ? (
          /* MFA is currently enabled */
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <p className="text-sm font-medium">
                Two-factor authentication is enabled
              </p>
            </div>
            <p className="text-sm text-zinc-300">
              Your account is protected with an authenticator app. You will be
              asked for a verification code when you sign in.
            </p>

            {showDisable ? (
              <div className="max-w-md space-y-3">
                <p className="text-sm text-zinc-300">
                  Enter your current authenticator code to disable MFA.
                </p>
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  value={disableCode}
                  onChange={(e) => { setDisableCode(e.target.value); }}
                  className="max-w-[200px] text-center text-lg tracking-widest"
                  aria-label="Enter your authenticator code"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-[44px]"
                    disabled={disableCode.length < 6 || disableMFA.isPending}
                    onClick={() => void handleDisableMFA()}
                  >
                    {disableMFA.isPending ? 'Disabling...' : 'Disable MFA'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-[44px]"
                    onClick={() => {
                      setShowDisable(false);
                      setDisableCode('');
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                onClick={() => {
                  setShowDisable(true);
                  setSuccess(null);
                }}
              >
                Disable MFA
              </Button>
            )}
          </div>
        ) : (
          /* MFA is not enabled */
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">
              Add an extra layer of security to your account. You will need an
              authenticator app such as Google Authenticator, Authy, or
              1Password.
            </p>
            <Button
              type="button"
              className="min-h-[44px]"
              disabled={enableMFA.isPending}
              onClick={() => void handleEnableMFA()}
            >
              {enableMFA.isPending ? 'Setting up...' : 'Enable MFA'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SecuritySettingsPage() {
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    },
  });

  async function onSubmit(values: ChangePasswordFormValues) {
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      await api.post('/api/v1/auth/change-password', {
        current_password: values.currentPassword,
        new_password: values.newPassword,
      });
      setPasswordSuccess(true);
      form.reset();
    } catch (error) {
      setPasswordError(getApiErrorMessage(error, 'Failed to change password'));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Security</h1>
        <p className="mt-1 text-zinc-300">
          Manage your password and account security
        </p>
      </div>

      {/* Change Password */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5" aria-hidden="true" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
              className="max-w-md space-y-4"
              noValidate
            >
              {passwordError ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {passwordError}
                </div>
              ) : null}

              {passwordSuccess ? (
                <div
                  role="status"
                  className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
                >
                  Password changed successfully.
                </div>
              ) : null}

              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter current password"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter new password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmNewPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Confirm new password"
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
                className="min-h-[44px]"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? 'Changing...'
                  : 'Change Password'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <div className="glass-divider" role="separator" />

      {/* MFA */}
      <MFASection />

      <div className="glass-divider" role="separator" />

      {/* Connected OAuth accounts (ASR-5.1.1.v) */}
      <ConnectedAccounts />

      <div className="glass-divider" role="separator" />

      {/* Active Sessions */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text text-lg">Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-300">
            You are currently signed in. Your session will expire after 60
            minutes of inactivity.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
