'use client';

import { Separator } from '@/components/ui/separator';
import { formatCents } from '@/lib/utils';
import type { PaymentBreakdown } from '@/types';

interface PaymentBreakdownDisplayProps {
  breakdown: PaymentBreakdown;
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
          Platform fee ({String(breakdown.fee_percentage)}%)
        </span>
        <span>{formatCents(breakdown.platform_fee_cents)}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">
          Guarantee fee ({String(breakdown.guarantee_percentage)}%)
        </span>
        <span>{formatCents(breakdown.guarantee_fee_cents)}</span>
      </div>

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
