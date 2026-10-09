'use client';

import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { InsuranceQuoteCompare } from '@/components/insurance/InsuranceQuoteCompare';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';

// Reads ?contractId=&coverageCents= — must live under a Suspense boundary so
// useSearchParams() doesn't opt the whole route into client-only rendering
// (Next 15 App Router requirement; same pattern as disputes/new).
function InsuranceQuotesContent() {
  const enabled = useFeatureFlag('insurance_competition');
  const searchParams = useSearchParams();

  // Optional deep-link context: /insurance/quotes?contractId=...&coverageCents=...
  const contractId = searchParams.get('contractId') ?? undefined;
  const coverageCentsParam = searchParams.get('coverageCents');
  const coverageCents = coverageCentsParam
    ? Number(coverageCentsParam)
    : undefined;
  const defaultCoverageCents =
    coverageCents !== undefined && Number.isFinite(coverageCents) && coverageCents > 0
      ? coverageCents
      : undefined;

  return (
    <div className="space-y-6">
      <Link
        href={'/insurance' as Route}
        className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Insurance
      </Link>

      {enabled ? (
        <InsuranceQuoteCompare
          contractId={contractId}
          defaultCoverageCents={defaultCoverageCents}
        />
      ) : (
        <EmptyState
          icon={<AnimatedIllustration type="search-empty" size="sm" />}
          title="Not available yet"
          description="Competitive insurance quotes aren't enabled for your account yet. Check back soon."
          className="glass border-white/10"
        />
      )}
    </div>
  );
}

function InsuranceQuotesFallback() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading insurance quotes">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}

export default function InsuranceQuotesPage() {
  return (
    <PageTransition>
      <Suspense fallback={<InsuranceQuotesFallback />}>
        <InsuranceQuotesContent />
      </Suspense>
    </PageTransition>
  );
}
