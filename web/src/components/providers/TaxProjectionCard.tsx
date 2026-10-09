'use client';

import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/utils';

interface TaxProjectionCardProps {
  ytdEarningsCents: number;
  taxYear: number;
}

export function TaxProjectionCard({ ytdEarningsCents, taxYear }: TaxProjectionCardProps) {
  // `new Date().getMonth()` differs across a month boundary between SSR and the
  // client → hydration mismatch. Compute the month post-mount; until then leave
  // the time-derived estimates as a neutral em-dash placeholder.
  const [currentMonth, setCurrentMonth] = useState<number | null>(null);
  useEffect(() => {
    setCurrentMonth(new Date().getMonth() + 1);
  }, []);

  const estimatedAnnualCents =
    currentMonth === null ? null : Math.round(ytdEarningsCents * (12 / currentMonth));
  const estimatedTaxCents =
    estimatedAnnualCents === null ? null : Math.round(estimatedAnnualCents * 0.25);
  const q4PaymentCents = estimatedTaxCents === null ? null : Math.round(estimatedTaxCents / 4);

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/5">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[var(--brand-gold)] text-sm font-medium">
          Tax Projection {String(taxYear)}
        </CardTitle>
        <AlertCircle className="text-[var(--brand-gold)] h-4 w-4" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-300">
          Based on{' '}
          <span className="font-semibold text-zinc-100">{formatCents(ytdEarningsCents)}</span> YTD,
          estimate{' '}
          <span className="text-[var(--brand-gold)] font-bold text-lg" suppressHydrationWarning>
            {estimatedTaxCents === null ? '—' : `~${formatCents(estimatedTaxCents)}`}
          </span>{' '}
          owed in {String(taxYear)}.
        </p>

        <div className="rounded-md border border-[var(--brand-gold)]/10 bg-[var(--brand-gold)]/5 p-3">
          <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide mb-1">
            Quarterly Breakdown
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q, i) => (
              <div key={q} className="flex justify-between">
                <span className="text-zinc-400">{q}</span>
                <span
                  className={
                    i === 3 ? 'font-semibold text-[var(--brand-gold)]' : 'text-zinc-300'
                  }
                  suppressHydrationWarning
                >
                  {q4PaymentCents === null ? '—' : `~${formatCents(q4PaymentCents)}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-zinc-500">
          Estimate only. Consult a tax professional for personalized advice.
        </p>
      </CardContent>
    </Card>
  );
}
