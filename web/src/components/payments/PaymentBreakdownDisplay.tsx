'use client';

import { Separator } from '@/components/ui/separator';
import { formatCents } from '@/lib/utils';
import type { PaymentBreakdown } from '@/types';

interface PaymentBreakdownDisplayProps {
  breakdown: PaymentBreakdown;
}

// Fee percentages arrive as 0..1 fractions (e.g. 0.10); show them as whole
// percents (e.g. "10%") with trailing-zero trimming.
function formatPct(fraction: number): string {
  // Keep this a string throughout (lint: no numbers in template literals) and
  // trim trailing zeros: 0.10 -> "10%", 0.125 -> "12.5%".
  const pct = (fraction * 100).toFixed(2).replace(/\.?0+$/, '');
  return `${pct}%`;
}

export function PaymentBreakdownDisplay({ breakdown }: PaymentBreakdownDisplayProps) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span>{formatCents(breakdown.subtotal_cents)}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">
          Platform fee ({formatPct(breakdown.fee_percentage)})
        </span>
        <span>{formatCents(breakdown.platform_fee_cents)}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">
          Guarantee fee ({formatPct(breakdown.guarantee_percentage)})
        </span>
        <span>{formatCents(breakdown.guarantee_fee_cents)}</span>
      </div>

      {breakdown.lead_gen_fee_cents > 0 ? (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            Lead-gen fee ({formatPct(breakdown.lead_gen_percentage)})
          </span>
          <span>{formatCents(breakdown.lead_gen_fee_cents)}</span>
        </div>
      ) : null}

      <Separator />

      <div className="flex items-center justify-between font-bold">
        <span>Total</span>
        <span>{formatCents(breakdown.total_cents)}</span>
      </div>

      <div className="flex items-center justify-between text-muted-foreground">
        <span>Provider receives</span>
        <span>{formatCents(breakdown.provider_payout_cents)}</span>
      </div>
    </div>
  );
}
