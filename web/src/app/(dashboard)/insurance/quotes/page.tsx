'use client';

import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { InsuranceQuoteCompare } from '@/components/insurance/InsuranceQuoteCompare';
import { EmptyState } from '@/components/ui/empty-state';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { PageTransition } from '@/components/ui/page-transition';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';

export default function InsuranceQuotesPage() {
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
    <PageTransition>
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
    </PageTransition>
  );
}
