'use client';

import { Banknote, CreditCard, DollarSign, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useContracts } from '@/hooks/useContracts';
import { useMyAdvances, useRequestAdvance } from '@/hooks/useWorkingCapital';
import { cn, formatCents } from '@/lib/utils';
import type { AdvanceStatus, WorkingCapitalAdvance } from '@/types';
import { ADVANCE_STATUS } from '@/types';

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string;
  description?: string;
  icon: typeof DollarSign;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

const STATUS_CLASSES: Record<AdvanceStatus, string> = {
  requested: 'bg-blue-100 text-blue-800 border-blue-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  disbursed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  repaying: 'bg-amber-100 text-amber-800 border-amber-200',
  repaid: 'bg-gray-100 text-gray-800 border-gray-200',
  defaulted: 'bg-red-100 text-red-800 border-red-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ProviderAdvancesPage() {
  const { data: advancesData, isLoading } = useMyAdvances();
  const { data: contractsData } = useContracts({ status: 'active' });
  const requestAdvance = useRequestAdvance();

  const [selectedContract, setSelectedContract] = useState('');
  const [amountDollars, setAmountDollars] = useState('');

  const advances = advancesData?.advances ?? [];

  const totalAdvanced = advances.reduce((sum, a) => sum + a.advance_amount_cents, 0);
  const outstanding = advances
    .filter((a) => a.status === ADVANCE_STATUS.DISBURSED || a.status === ADVANCE_STATUS.REPAYING)
    .reduce((sum, a) => sum + (a.advance_amount_cents + a.fee_cents - a.repaid_cents), 0);

  // Simple available credit heuristic: total contract values minus outstanding
  const awardedContracts = contractsData?.contracts ?? [];
  const totalContractValue = awardedContracts.reduce((sum, c) => sum + c.amount_cents, 0);
  const availableCredit = Math.max(0, Math.round(totalContractValue * 0.5) - outstanding);

  function handleRequestAdvance(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedContract || !amountDollars) return;

    const amountCents = Math.round(parseFloat(amountDollars) * 100);
    if (Number.isNaN(amountCents) || amountCents <= 0) return;

    requestAdvance.mutate(
      {
        contract_id: selectedContract,
        advance_amount_cents: amountCents,
      },
      {
        onSuccess: () => {
          setSelectedContract('');
          setAmountDollars('');
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Working Capital</h1>
          <p className="mt-1 text-muted-foreground">
            Access working capital against your awarded contracts.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`skel-stat-${String(i)}`} className="h-28" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`skel-adv-${String(i)}`} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Working Capital</h1>
        <p className="mt-1 text-muted-foreground">
          Access working capital against your awarded contracts.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Advanced"
          value={formatCents(totalAdvanced)}
          description="Lifetime advances"
          icon={DollarSign}
          loading={false}
        />
        <StatCard
          title="Outstanding Balance"
          value={formatCents(outstanding)}
          description="Amount to repay"
          icon={Banknote}
          loading={false}
        />
        <StatCard
          title="Available Credit"
          value={formatCents(availableCredit)}
          description="Based on active contracts"
          icon={CreditCard}
          loading={false}
        />
      </div>

      {/* Request advance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request Advance</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRequestAdvance} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-select">Contract</Label>
                <Select value={selectedContract} onValueChange={setSelectedContract}>
                  <SelectTrigger id="contract-select" className="min-h-[44px]" aria-label="Select contract">
                    <SelectValue placeholder="Select a contract" />
                  </SelectTrigger>
                  <SelectContent>
                    {awardedContracts.map((contract) => (
                      <SelectItem key={contract.id} value={contract.id}>
                        {contract.contract_number} - {formatCents(contract.amount_cents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="advance-amount">Amount ($)</Label>
                <Input
                  id="advance-amount"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="0.00"
                  value={amountDollars}
                  onChange={(e) => { setAmountDollars(e.target.value); }}
                  className="min-h-[44px]"
                />
              </div>
            </div>
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={!selectedContract || !amountDollars || requestAdvance.isPending}
            >
              {requestAdvance.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Request Advance
            </Button>
            {requestAdvance.isError ? (
              <p className="text-sm text-destructive">Failed to request advance. Please try again.</p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {/* Advances list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advance History</CardTitle>
        </CardHeader>
        <CardContent>
          {advances.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No advances yet. Request working capital against your awarded contracts.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {advances.map((advance: WorkingCapitalAdvance) => (
                <div
                  key={advance.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium tabular-nums">
                        {formatCents(advance.advance_amount_cents)}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn('text-xs capitalize', STATUS_CLASSES[advance.status])}
                      >
                        {advance.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {advance.contract_number ?? advance.contract_id.slice(0, 8)}
                      {' - '}
                      {formatDate(advance.created_at)}
                    </p>
                    {advance.fee_cents > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Fee: {formatCents(advance.fee_cents)}
                        {advance.repaid_cents > 0
                          ? ` | Repaid: ${formatCents(advance.repaid_cents)}`
                          : ''}
                      </p>
                    ) : null}
                    {advance.rejection_reason ? (
                      <p className="text-xs text-destructive">
                        Rejected: {advance.rejection_reason}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
