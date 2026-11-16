'use client';

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { getApiErrorMessage } from '@/lib/api';
import { passkeysSupported, registerPasskey } from '@/lib/passkeys';

/**
 * Enrollment for an already signed-in account. Hidden unless the server
 * `passkeys` flag is explicitly true and this browser supports WebAuthn.
 */
export function PasskeyEnrollment() {
  const flags = useFeatureFlags();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(passkeysSupported());
  }, []);

  if (flags.passkeys !== true || !supported) {
    return null;
  }

  async function onAdd(): Promise<void> {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      await registerPasskey();
      setMessage('Passkey added. You can sign in with it on this device.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not add a passkey'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text flex items-center gap-2 text-lg">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
          Passkeys
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-300">
          Passkeys sign you in with this device. Nothing to type or phish.
        </p>
        <Button
          type="button"
          className="min-h-[44px]"
          disabled={busy}
          onClick={() => {
            void onAdd();
          }}
        >
          {busy ? 'Adding passkey…' : 'Add a passkey'}
        </Button>
        {message ? (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
