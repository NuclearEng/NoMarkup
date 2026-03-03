'use client';

import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAcceptContract, useCancelContract } from '@/hooks/useContracts';
import { formatCents } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { Contract } from '@/types';

import { AcceptanceCountdown } from './AcceptanceCountdown';
import { getPaymentTimingLabel } from './ContractCard';

interface ContractAcceptanceProps {
  contract: Contract;
}

export function ContractAcceptance({ contract }: ContractAcceptanceProps) {
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const user = useAuthStore((state) => state.user);
  const acceptContract = useAcceptContract();
  const cancelContract = useCancelContract();

  const isCustomer = user?.id === contract.customer_id;
  const isProvider = user?.id === contract.provider_id;

  const currentUserAccepted = (isCustomer && contract.customer_accepted) || (isProvider && contract.provider_accepted);

  function handleAccept() {
    acceptContract.mutate(contract.id);
  }

  function handleDecline() {
    cancelContract.mutate(contract.id, {
      onSuccess: () => {
        setShowDeclineConfirm(false);
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Contract Acceptance</h3>
        <AcceptanceCountdown deadline={contract.acceptance_deadline} />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contract terms summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Amount</span>
            <span className="text-lg font-bold">{formatCents(contract.amount_cents)}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Payment Timing</span>
            <span className="text-sm font-medium">
              {getPaymentTimingLabel(contract.payment_timing)}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Milestones</span>
            <span className="text-sm font-medium">
              {String(contract.milestones.length)} milestone{contract.milestones.length !== 1 ? 's' : ''}
            </span>
          </div>
          {contract.milestones.length > 0 ? (
            <div className="space-y-2 rounded-lg border p-3">
              {contract.milestones.map((milestone) => (
                <div key={milestone.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {String(milestone.sort_order)}. {milestone.description}
                  </span>
                  <span className="font-medium">{formatCents(milestone.amount_cents)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <Separator />

        {/* Acceptance status */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Acceptance Status</p>
          <div className="flex items-center gap-2">
            {contract.customer_accepted ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="h-3 w-3" aria-hidden="true" />
                Customer Accepted
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <XCircle className="h-3 w-3" aria-hidden="true" />
                Customer Pending
              </Badge>
            )}
            {contract.provider_accepted ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="h-3 w-3" aria-hidden="true" />
                Provider Accepted
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <XCircle className="h-3 w-3" aria-hidden="true" />
                Provider Pending
              </Badge>
            )}
          </div>
        </div>

        {/* Actions */}
        {(isCustomer || isProvider) ? (
          <div className="space-y-3 border-t pt-4">
            {currentUserAccepted ? (
              <div className="flex items-center gap-2 rounded-lg border bg-green-50 p-3 text-sm text-green-700">
                <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                You have already accepted this contract. Waiting for the other party.
              </div>
            ) : showDeclineConfirm ? (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm">
                  Are you sure you want to decline this contract? This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    className="min-h-[44px] flex-1"
                    onClick={handleDecline}
                    disabled={cancelContract.isPending}
                  >
                    {cancelContract.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Confirm Decline
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => { setShowDeclineConfirm(false); }}
                    disabled={cancelContract.isPending}
                  >
                    Cancel
                  </Button>
                </div>
                {cancelContract.isError ? (
                  <p className="text-sm text-destructive">
                    Failed to decline contract. Please try again.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex gap-3">
                <Button
                  className="min-h-[44px] flex-1"
                  onClick={handleAccept}
                  disabled={acceptContract.isPending}
                >
                  {acceptContract.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Accept Contract
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => { setShowDeclineConfirm(true); }}
                  disabled={acceptContract.isPending}
                >
                  Decline
                </Button>
              </div>
            )}
            {acceptContract.isError ? (
              <p className="text-sm text-destructive">
                Failed to accept contract. Please try again.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
