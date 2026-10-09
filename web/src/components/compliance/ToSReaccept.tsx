'use client';

// ToS re-acceptance modal — version-pinned. Renders only when the
// authenticated user's last-accepted ToS version differs from the
// platform's current version (or they've never accepted one).
//
// Pairs with gateway/internal/handler/compliance.go:
//   GET /api/v1/tos/current     → ToSVersion
//   GET /api/v1/me/tos-acceptance → { tos_version, accepted_at }
//   POST /api/v1/me/tos-acceptance { tos_version }
//
// The modal cannot be dismissed without acceptance — re-acceptance is
// load-bearing for legal defensibility.

import { Button } from '@/components/ui/button';
import {
  useAcceptToS,
  useCurrentToS,
  useMyToSAcceptance,
} from '@/hooks/useCompliance';
import { useAuthStore } from '@/stores/auth-store';

export function ToSReaccept() {
  const isAuthed = useAuthStore((s) => Boolean(s.accessToken));
  const current = useCurrentToS();
  const mine = useMyToSAcceptance(isAuthed);
  const accept = useAcceptToS();

  if (!isAuthed) return null;
  if (current.isLoading || mine.isLoading) return null;
  if (!current.data) return null;

  // Local capture so the closure below doesn't trigger
  // "unnecessary conditional" — TS narrows the let binding.
  const tos = current.data;

  // Already accepted the current version → nothing to do.
  if (mine.data?.tos_version === tos.version) return null;

  const isFirstTime = !mine.data?.tos_version;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tos-reaccept-title"
      data-testid="tos-reaccept-modal"
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/95 p-5 shadow-2xl">
        <h2 id="tos-reaccept-title" className="text-base font-semibold text-white">
          {isFirstTime ? 'Accept our Terms of Service' : 'Updated Terms of Service'}
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          {isFirstTime
            ? 'Please review and accept our terms before continuing.'
            : "Our terms have been updated. Review the latest version and accept to continue."}
        </p>

        <div
          className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-zinc-300"
          data-testid="tos-reaccept-version"
        >
          <p>
            <span className="font-medium text-zinc-200">Version:</span>{' '}
            <span className="font-mono">{tos.version}</span>
          </p>
          {tos.body_url ? (
            <p className="mt-1">
              <a
                href={tos.body_url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--brand-gold)] underline hover:opacity-80"
              >
                Read the full terms
              </a>
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          className="mt-4 min-h-[44px] w-full"
          data-testid="tos-reaccept-submit"
          disabled={accept.isPending}
          onClick={() => {
            accept.mutate(tos.version);
          }}
        >
          {accept.isPending ? 'Recording…' : 'I accept'}
        </Button>
      </div>
    </div>
  );
}
