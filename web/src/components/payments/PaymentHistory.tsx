'use client';

import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatCents } from '@/lib/utils';
import type { Payment } from '@/types';

import { PaymentStatusBadge } from './PaymentStatusBadge';

interface PaymentHistoryProps {
  payments: Payment[];
}

function PaymentRow({ payment }: { payment: Payment }) {
  const [expanded, setExpanded] = useState(false);

  const createdDate = new Date(payment.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-4 px-4 py-3 text-left"
          onClick={() => { setExpanded((prev) => !prev); }}
        >
          <div className="shrink-0 text-muted-foreground">
            {expanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-sm text-muted-foreground">{createdDate}</span>
              <span className="text-xs text-muted-foreground">
                Contract: {payment.contract_id.slice(0, 8)}...
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-semibold">{formatCents(payment.amount_cents)}</span>
            <PaymentStatusBadge status={payment.status} />
          </div>
        </button>

        {expanded ? (
          <div className="border-t px-4 py-3">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span>{formatCents(payment.amount_cents)}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Platform fee</span>
                <span>{formatCents(payment.platform_fee_cents)}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Guarantee fee</span>
                <span>{formatCents(payment.guarantee_fee_cents)}</span>
              </div>

              <Separator />

              <div className="flex items-center justify-between font-bold">
                <span>Provider payout</span>
                <span>{formatCents(payment.provider_payout_cents)}</span>
              </div>

              {payment.refund_amount_cents > 0 ? (
                <div className="flex items-center justify-between text-orange-600">
                  <span>Refunded</span>
                  <span>{formatCents(payment.refund_amount_cents)}</span>
                </div>
              ) : null}

              {payment.refund_reason ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Refund reason</span>
                  <span className="text-right">{payment.refund_reason}</span>
                </div>
              ) : null}

              {payment.failure_reason ? (
                <div className="flex items-center justify-between text-red-600">
                  <span>Failure reason</span>
                  <span className="text-right">{payment.failure_reason}</span>
                </div>
              ) : null}

              {payment.installment_number != null && payment.total_installments != null ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Installment</span>
                  <span>
                    {String(payment.installment_number)} of {String(payment.total_installments)}
                  </span>
                </div>
              ) : null}

              <div className="pt-2">
                <Link
                  href={`/contracts/${payment.contract_id}` as Route}
                  className="inline-flex min-h-[44px] items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  View Contract
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PaymentHistory({ payments }: PaymentHistoryProps) {
  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/50 py-12">
        <p className="text-sm text-muted-foreground">No payments found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="hidden items-center gap-4 px-4 py-2 text-xs font-medium uppercase text-muted-foreground sm:flex">
        <div className="w-4 shrink-0" />
        <div className="min-w-0 flex-1">Date / Contract</div>
        <div className="flex items-center gap-3">
          <span>Amount</span>
          <span className="w-[100px] text-right">Status</span>
        </div>
      </div>

      {payments.map((payment) => (
        <PaymentRow key={payment.id} payment={payment} />
      ))}
    </div>
  );
}
