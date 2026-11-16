'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { getApiErrorMessage } from '@/lib/api';
import { passkeysSupported, signInWithPasskey } from '@/lib/passkeys';
import { useAuthStore } from '@/stores/auth-store';

interface PasskeySignInButtonProps {
  email: string;
  disabled?: boolean;
  onSignedIn: () => void;
}

/**
 * Shown only when the server `passkeys` flag is explicitly on and the
 * browser can run WebAuthn. A missing flag hides the button (same as iOS).
 */
export function PasskeySignInButton({ email, disabled, onSignedIn }: PasskeySignInButtonProps) {
  const flags = useFeatureFlags();
  const adoptSession = useAuthStore((state) => state.adoptSession);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(passkeysSupported());
  }, []);

  if (flags.passkeys !== true || !supported) {
    return null;
  }

  async function onClick(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const session = await signInWithPasskey(email);
      adoptSession(session);
      onSignedIn();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Passkey sign-in failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 space-y-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] w-full"
        disabled={disabled || busy}
        onClick={() => {
          void onClick();
        }}
      >
        {busy ? 'Waiting for passkey…' : 'Sign in with Passkey'}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
