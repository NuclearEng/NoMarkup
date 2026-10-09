'use client';

import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect } from 'react';

/**
 * Scoped error boundary for the public marketing/browse surfaces
 * (/marketplace, /marketplace/[id], /jobs, /pricing, /legal, …).
 *
 * Without this, any client render error inside a public page bubbles all the
 * way to the ROOT boundary (app/global-error.tsx), which replaces the entire
 * document chrome with a bare "Something went wrong" screen. Per CLAUDE.md §9
 * (per-feature error boundaries) and §15 (graceful degradation), a single
 * feature crash should degrade to a scoped, on-brand error UI — keeping the
 * public layout (header/footer) intact — with a working retry.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="glass glass-highlight w-full max-w-md rounded-xl border border-[var(--brand-gold)]/10 p-8 text-center">
        <p className="text-sm font-semibold tracking-widest text-[var(--brand-gold)] uppercase">
          Something went wrong
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-100">
          We couldn&apos;t load this page
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          An unexpected error occurred while rendering this view. You can try
          again, or head back to browse.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--brand-gold)] px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-opacity hover:opacity-90 sm:w-auto"
          >
            Try again
          </button>
          <Link
            href={'/marketplace' as Route}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white sm:w-auto"
          >
            Back to marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}
