'use client';

// Age verification gate (18+). Shown to authenticated users on first
// visit when /api/v1/me/age-status returns { verified: false }.
//
// We never trust the client's age math — the gateway parses the DOB and
// validates >=18 server-side. This UI is a UX nicety; the audit trail
// lives on the server via users.dob_verified_at.
//
// Modal-style — but rendered inline so it doesn't need to coordinate with
// other dialogs. Uses a simple <div role="dialog" aria-modal="true">.

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMyAgeStatus, useSetDOB } from '@/hooks/useCompliance';
import { useAuthStore } from '@/stores/auth-store';

const MIN_AGE = 18;

interface AgeGateProps {
  /** When false, the gate never renders. Pass `true` from a top-level layout. */
  enabled?: boolean;
}

export function AgeGate({ enabled = true }: AgeGateProps) {
  const isAuthed = useAuthStore((s) => Boolean(s.accessToken));
  const status = useMyAgeStatus(enabled && isAuthed);
  const setDOB = useSetDOB();
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);

  const yearsOld = useMemo(() => {
    if (!dob) return null;
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - parsed.getFullYear();
    const m = now.getMonth() - parsed.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < parsed.getDate())) {
      years--;
    }
    return years;
  }, [dob]);

  if (!enabled || !isAuthed) return null;
  if (status.isLoading) return null;
  if (status.data?.verified) return null;

  function handleSubmit() {
    setError(null);
    if (!dob) {
      setError('Enter your date of birth');
      return;
    }
    if (yearsOld === null) {
      setError('Invalid date');
      return;
    }
    if (yearsOld < MIN_AGE) {
      setError(`You must be at least ${String(MIN_AGE)} to use NoMarkup`);
      return;
    }
    setDOB.mutate(dob);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      data-testid="age-gate-modal"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950/95 p-5 shadow-2xl">
        <h2 id="age-gate-title" className="text-base font-semibold text-white">
          Verify your age
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          NoMarkup requires all users to be at least {MIN_AGE} years old. Your
          date of birth is stored securely and never shown publicly.
        </p>

        <div className="mt-4 space-y-2">
          <Label htmlFor="age-gate-dob" className="text-xs text-zinc-300">
            Date of birth
          </Label>
          <Input
            id="age-gate-dob"
            type="date"
            value={dob}
            data-testid="age-gate-dob-input"
            aria-invalid={error !== null}
            aria-describedby={error ? 'age-gate-error' : undefined}
            onChange={(e) => {
              setDob(e.target.value);
              if (error) setError(null);
            }}
            max={new Date().toISOString().slice(0, 10)}
          />
        </div>

        {error ? (
          <p id="age-gate-error" role="alert" className="mt-2 text-xs text-red-400">
            {error}
          </p>
        ) : null}

        <Button
          type="button"
          className="mt-4 min-h-[44px] w-full"
          data-testid="age-gate-submit"
          disabled={setDOB.isPending}
          onClick={handleSubmit}
        >
          {setDOB.isPending ? 'Verifying…' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
