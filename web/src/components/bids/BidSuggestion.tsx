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
    <div className="rounded-lg border border-bid-active/30 bg-bid-active/10 p-3 text-sm">
      <div className="mb-1 font-medium text-bid-active">
        Market insight
      </div>
      <div className="text-bid-active/90">
        Similar jobs in this area typically close at{' '}
        <span className="font-semibold tabular-nums">
          {formatCents(pricing.p25_price_cents)}&ndash;{formatCents(pricing.p75_price_cents)}
        </span>
      </div>
      <div className="mt-1 text-xs text-bid-active/80">
        Based on {String(pricing.completed_jobs)} completed job
        {pricing.completed_jobs !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
