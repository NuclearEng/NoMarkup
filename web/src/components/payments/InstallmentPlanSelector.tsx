'use client';

import { useState } from 'react';

import { Loader2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCreateInstallmentPlan } from '@/hooks/useInstallments';
import { usePaymentMethods } from '@/hooks/usePayments';
import { formatCents } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { InstallmentPlan } from '@/types';

interface InstallmentPlanSelectorProps {
  totalCents: number;
  contractId: string;
  /** Provider on the contract — required by the create RPC (escrow payout target). */
  providerId: string;
  /** Fired after a plan is successfully created, so the page can swap to the schedule. */
  onCreated?: (plan: InstallmentPlan) => void;
  className?: string;
}

const FINANCING_FEE_3 = 0.03; // 3% for 3 installments
const FINANCING_FEE_6 = 0.05; // 5% for 6 installments

// Only 3 and 6 are accepted by the gateway (installment_count must be 3 or 6);
// "Pay in Full" is the no-BNPL escape hatch and creates no plan.
type InstallmentCount = 1 | 3 | 6;

interface PlanOption {
  label: string;
  installments: InstallmentCount;
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

/**
 * BNPL entry point: lets a customer split a contract payment into 3 or 6
 * installments (or keep paying in full). On confirm it creates the plan via
 * `useCreateInstallmentPlan`, which sends the required Idempotency-Key header
 * and invalidates the installment-plans cache so the schedule appears.
 *
 * Gating is the caller's responsibility (the contract page checks the
 * `customer_bnpl` flag, customer role, ACTIVE status, and "no plan yet"). The
 * gateway re-enforces the flag, so this is purely the UI surface.
 */
export function InstallmentPlanSelector({
  totalCents,
  contractId,
  providerId,
  onCreated,
  className,
}: InstallmentPlanSelectorProps) {
  const [selected, setSelected] = useState<InstallmentCount>(1);
  const plans = buildPlans(totalCents);
  const createPlan = useCreateInstallmentPlan();
  const { data: methodsData, isLoading: methodsLoading } = usePaymentMethods();

  const methods = methodsData?.payment_methods ?? [];
  const defaultMethod = methods.find((m) => m.is_default) ?? methods[0];
  const hasPaymentMethod = !!defaultMethod;

  function handleConfirm() {
    // Pay-in-full creates no installment plan — the contract is paid through
    // the normal checkout flow, so there is nothing to do here.
    if (selected === 1 || !defaultMethod) return;

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

    createPlan.mutate(
      {
        contract_id: contractId,
        // customer_id is derived server-side from the JWT; send '' to satisfy
        // the typed input (the gateway ignores any client-supplied value).
        customer_id: '',
        provider_id: providerId,
        total_amount_cents: totalCents,
        installment_count: selected,
        payment_method_id: defaultMethod.id,
        idempotency_key: idempotencyKey,
      },
      {
        onSuccess: (plan) => {
          onCreated?.(plan);
        },
      },
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Split your payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <fieldset className="space-y-3" disabled={createPlan.isPending}>
          <legend className="sr-only">Choose a payment plan</legend>
          {plans.map((plan) => (
            <button
              key={plan.installments}
              type="button"
              onClick={() => {
                setSelected(plan.installments);
              }}
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
        </fieldset>

        {selected !== 1 ? (
          !methodsLoading && !hasPaymentMethod ? (
            <p className="text-sm text-muted-foreground">
              Add a{' '}
              <Link
                href={'/settings/payment-methods' as Route}
                className="text-primary hover:underline"
              >
                payment method
              </Link>{' '}
              to pay in installments.
            </p>
          ) : (
            <Button
              type="button"
              className="min-h-[44px] w-full"
              onClick={handleConfirm}
              disabled={createPlan.isPending || methodsLoading || !hasPaymentMethod}
            >
              {createPlan.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Set up {String(selected)} payments
            </Button>
          )
        ) : null}

        {createPlan.isError ? (
          <p className="text-destructive text-sm" role="alert">
            Couldn&apos;t set up your payment plan. Please try again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
