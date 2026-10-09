'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

const MISSING_TOKEN = 'This link is missing a token.';
const SUCCESS_MESSAGE =
  'Marketing email is off. You can turn individual messages back on in Settings → Notifications.';
const ERROR_FALLBACK =
  'This unsubscribe link did not work. Open Settings → Notifications while signed in.';
const MAX_VISIBLE_ERROR = 200;

function visibleUnsubscribeError(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VISIBLE_ERROR || trimmed.includes('\n')) {
    return ERROR_FALLBACK;
  }
  return trimmed;
}

function readErrorField(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return null;
  }
  const value: unknown = body.error;
  return typeof value === 'string' ? value : null;
}

async function errorFromResponse(res: Response): Promise<string> {
  try {
    const field = readErrorField(await res.json());
    if (field !== null) {
      return visibleUnsubscribeError(field);
    }
  } catch {
    return ERROR_FALLBACK;
  }
  return ERROR_FALLBACK;
}

export function UnsubscribeClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState(ERROR_FALLBACK);

  async function onUnsubscribe() {
    if (token === '' || status === 'pending') {
      return;
    }
    setStatus('pending');
    try {
      const res = await fetch('/api/v1/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        setErrorMessage(await errorFromResponse(res));
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch {
      setErrorMessage(ERROR_FALLBACK);
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">Unsubscribe</h1>
      <p className="text-sm text-muted-foreground">
        This turns off marketing email. Account and order messages stay available in the app.
      </p>
      {token === '' ? <p className="text-sm text-foreground">{MISSING_TOKEN}</p> : null}
      {token !== '' && status !== 'success' ? (
        <Button
          type="button"
          className="min-h-[44px] w-fit"
          disabled={status === 'pending'}
          onClick={() => {
            void onUnsubscribe();
          }}
        >
          Unsubscribe
        </Button>
      ) : null}
      <div aria-live="polite">
        {status === 'success' ? <p className="text-sm text-foreground">{SUCCESS_MESSAGE}</p> : null}
        {status === 'error' ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
      <p>
        <Link
          href="/settings/notifications"
          className="inline-flex min-h-[44px] items-center text-sm text-foreground underline underline-offset-4"
        >
          Settings → Notifications
        </Link>
      </p>
      <p>
        <Link
          href="/privacy"
          className="inline-flex min-h-[44px] items-center text-sm text-foreground underline underline-offset-4"
        >
          Privacy
        </Link>
      </p>
    </div>
  );
}
