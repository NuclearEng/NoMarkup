import Link from 'next/link';
import type { Route } from 'next';

import { Logo } from '@/components/layout/Logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="text-center">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" asLink={false} />
        </div>
        <p className="text-sm font-semibold tracking-widest text-[var(--brand-gold)] uppercase">
          404
        </p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Page not found
        </h1>
        <p className="mt-4 text-base text-zinc-400">
          This page isn&apos;t on the market. Head home, or browse open jobs where providers compete
          on price.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href={'/' as Route}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-[var(--brand-gold)] px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-opacity hover:opacity-90"
          >
            Go home
          </Link>
          <Link
            href={'/jobs' as Route}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Browse jobs
          </Link>
        </div>
      </div>
    </div>
  );
}
