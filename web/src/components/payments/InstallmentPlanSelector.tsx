'use client';

import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface PaymentPlan {
  installments: number;
  perPaymentCents: number;
}

interface InstallmentPlanSelectorProps {
  totalCents: number;
  onSelect: (plan: PaymentPlan) => void;
  className?: string;
}

const FINANCING_FEE_3 = 0.03; // 3% for 3 installments
const FINANCING_FEE_6 = 0.05; // 5% for 6 installments

interface PlanOption {
  label: string;
  installments: number;
  totalCents: number;
  perPaymentCents: number;
  feeLabel: string | null;
}

function buildPlans(totalCents: number): PlanOption[] {
  const total3 = Math.round(totalCents * (1 + FINANCING_FEE_3));
  const total6 = Math.round(totalCents * (1 + FINANCING_FEE_6));

  return [
    {
      label: 'Pay in Full',
      installments: 1,
      totalCents,
      perPaymentCents: totalCents,
      feeLabel: null,
    },
    {
      label: '3 Payments',
      installments: 3,
      totalCents: total3,
      perPaymentCents: Math.round(total3 / 3),
      feeLabel: `${String(FINANCING_FEE_3 * 100)}% financing fee`,
    },
    {
      label: '6 Payments',
      installments: 6,
      totalCents: total6,
      perPaymentCents: Math.round(total6 / 6),
      feeLabel: `${String(FINANCING_FEE_6 * 100)}% financing fee`,
    },
  ];
}

export function InstallmentPlanSelector({
  totalCents,
  onSelect,
  className,
}: InstallmentPlanSelectorProps) {
  const [selected, setSelected] = useState<number>(1);
  const plans = buildPlans(totalCents);

  function handleSelect(plan: PlanOption) {
    setSelected(plan.installments);
    onSelect({
      installments: plan.installments,
      perPaymentCents: plan.perPaymentCents,
    });
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Payment Plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {plans.map((plan) => (
          <button
            key={plan.installments}
            type="button"
            onClick={() => { handleSelect(plan); }}
            className={cn(
              'flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors min-h-[44px]',
              selected === plan.installments
                ? 'border-primary bg-primary/5 ring-2 ring-primary'
                : 'hover:bg-muted/50',
            )}
            aria-pressed={selected === plan.installments}
          >
            <div>
              <p className="font-medium">{plan.label}</p>
              {plan.feeLabel ? (
                <p className="text-xs text-muted-foreground">{plan.feeLabel}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="font-bold tabular-nums">
                {formatCents(plan.perPaymentCents)}
                {plan.installments > 1 ? '/mo' : ''}
              </p>
              {plan.installments > 1 ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Total: {formatCents(plan.totalCents)}
                </p>
              ) : null}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
