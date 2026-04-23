'use client';

import { usePricingByCategory } from '@/hooks/usePricing';
import { formatCents } from '@/lib/utils';

interface BidSuggestionProps {
  categorySlug: string;
  zipCode?: string;
}

export function BidSuggestion({ categorySlug, zipCode }: BidSuggestionProps) {
  const { data, isLoading } = usePricingByCategory(categorySlug, zipCode);

  if (isLoading || !data?.prices.length) return null;

  const pricing = data.prices[0];
  if (!pricing) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
      <div className="mb-1 font-medium text-blue-900 dark:text-blue-100">
        Market insight
      </div>
      <div className="text-blue-700 dark:text-blue-300">
        Similar jobs in this area typically close at{' '}
        <span className="font-semibold tabular-nums">
          {formatCents(pricing.p25_price_cents)}&ndash;{formatCents(pricing.p75_price_cents)}
        </span>
      </div>
      <div className="mt-1 text-xs text-blue-500 dark:text-blue-400">
        Based on {String(pricing.completed_jobs)} completed job
        {pricing.completed_jobs !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
