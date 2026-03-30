'use client';

import {
  AlertCircle,
  Banknote,
  ChevronDown,
  ChevronUp,
  CreditCard,
  DollarSign,
  HelpCircle,
  Info,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
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

// ────────────────────────────────────────
// Constants
// ────────────────────────────────────────

/** Fee rate applied to working capital advances (5%) */
const FEE_RATE = 0.05;

/** Maximum credit utilization — providers can borrow up to 50% of active contract value */
const MAX_CREDIT_UTILIZATION = 0.5;

const STATUS_CLASSES: Record<AdvanceStatus, string> = {
  requested: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  approved: 'bg-green-500/10 text-green-300 border-green-500/30',
  disbursed: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  repaying: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  repaid: 'bg-white/5 text-white/50 border-white/10',
  defaulted: 'bg-red-500/10 text-red-300 border-red-500/30',
  rejected: 'bg-red-500/10 text-red-300 border-red-500/30',
};

const STATUS_LABELS: Record<AdvanceStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  disbursed: 'Disbursed',
  repaying: 'Repaying',
  repaid: 'Repaid',
  defaulted: 'Defaulted',
  rejected: 'Rejected',
};

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function computeFeeCents(amountCents: number): number {
  return Math.round(amountCents * FEE_RATE);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      return 'You do not have permission to request advances. Your account may need verification.';
    }
    if (error.message.includes('429') || error.message.includes('Too Many')) {
      return 'Too many requests. Please wait a moment before trying again.';
    }
    if (error.message.includes('422') || error.message.includes('Validation')) {
      return 'Invalid request. Please check the amount and selected contract.';
    }
    if (error.message.includes('409') || error.message.includes('Conflict')) {
      return 'An advance for this contract is already pending review.';
    }
    if (error.message.includes('Network') || error.message.includes('fetch')) {
      return 'Network error. Please check your connection and try again.';
    }
  }
  return 'Failed to request advance. Please try again.';
}

// ────────────────────────────────────────
// StatCard
// ────────────────────────────────────────

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
    <div className="glass glass-highlight rounded-xl p-5">
      <div className="flex items-center justify-between pb-2">
        <p className="text-sm font-medium text-white/50">{title}</p>
        <Icon className="h-4 w-4 text-white/30" aria-hidden="true" />
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="gold-text text-2xl font-bold tabular-nums">{value}</p>
      )}
      {description ? <p className="mt-1 text-xs text-white/40">{description}</p> : null}
    </div>
  );
}

// ────────────────────────────────────────
// FeePreview — shows estimated fees before request
// ────────────────────────────────────────

function FeePreview({ amountCents }: { amountCents: number }) {
  const feeCents = computeFeeCents(amountCents);
  const totalCents = amountCents + feeCents;

  if (amountCents <= 0) return null;

  return (
    <div className="rounded-lg border border-[var(--brand-gold)]/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white/70">
        <Info className="h-4 w-4 text-[var(--brand-gold)]" aria-hidden="true" />
        Fee Estimate
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Advance amount</span>
          <span className="text-white/80 tabular-nums">{formatCents(amountCents)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Fee ({String(FEE_RATE * 100)}%)</span>
          <span className="text-white/80 tabular-nums">{formatCents(feeCents)}</span>
        </div>
        <div
          className="mt-1 border-t border-white/10 pt-2"
          aria-label={`Total repayment: ${formatCents(totalCents)}`}
        >
          <div className="flex items-center justify-between text-sm font-semibold">
            <span className="text-white/70">Total to repay</span>
            <span className="gold-text tabular-nums">{formatCents(totalCents)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// CreditExplanation — collapsible section
// ────────────────────────────────────────

function CreditExplanation({
  totalContractValue,
  outstanding,
  availableCredit,
}: {
  totalContractValue: number;
  outstanding: number;
  availableCredit: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxCredit = Math.round(totalContractValue * MAX_CREDIT_UTILIZATION);
  const utilizationPercent =
    maxCredit > 0 ? Math.min(100, Math.round((outstanding / maxCredit) * 100)) : 0;

  return (
    <div className="glass glass-highlight rounded-xl">
      <button
        type="button"
        className="flex min-h-[44px] w-full items-center justify-between p-4 text-left"
        onClick={() => {
          setExpanded((prev) => !prev);
        }}
        aria-expanded={expanded}
        aria-controls="credit-explanation-content"
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-[var(--brand-gold)]" aria-hidden="true" />
          <span className="text-sm font-medium text-white/70">How is my credit determined?</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-white/40" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-white/40" aria-hidden="true" />
        )}
      </button>

      {expanded ? (
        <div id="credit-explanation-content" className="border-t border-white/5 px-4 pt-3 pb-4">
          <div className="space-y-3 text-sm text-white/60">
            <p>
              Your available credit is based on the total value of your active contracts. You can
              borrow up to{' '}
              <span className="font-medium text-white/80">
                {String(MAX_CREDIT_UTILIZATION * 100)}%
              </span>{' '}
              of your combined active contract value, minus any outstanding advance balances.
            </p>

            {/* Credit utilization bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/40">Credit utilization</span>
                <span className="text-white/60 tabular-nums">{String(utilizationPercent)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    utilizationPercent < 50
                      ? 'bg-emerald-500/60'
                      : utilizationPercent < 80
                        ? 'bg-amber-500/60'
                        : 'bg-red-500/60',
                  )}
                  style={{ width: `${String(utilizationPercent)}%` }}
                  role="progressbar"
                  aria-valuenow={utilizationPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Credit utilization"
                />
              </div>
            </div>

            {/* Breakdown */}
            <div className="space-y-1.5 rounded-lg bg-white/[0.02] p-3">
              <div className="flex justify-between">
                <span className="text-white/40">Active contract value</span>
                <span className="text-white/60 tabular-nums">
                  {formatCents(totalContractValue)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">
                  Max credit ({String(MAX_CREDIT_UTILIZATION * 100)}%)
                </span>
                <span className="text-white/60 tabular-nums">{formatCents(maxCredit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Outstanding balance</span>
                <span className="text-white/60 tabular-nums">- {formatCents(outstanding)}</span>
              </div>
              <div className="flex justify-between border-t border-white/5 pt-1.5 font-medium">
                <span className="text-white/60">Available credit</span>
                <span className="gold-text tabular-nums">{formatCents(availableCredit)}</span>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-white/[0.02] p-3 text-xs text-white/40">
              <TrendingUp
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand-gold)]/60"
                aria-hidden="true"
              />
              <span>
                Win more contracts and maintain a good repayment history to increase your available
                credit over time.
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────
// ErrorBanner — styled error with retry
// ────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass-tinted-red flex items-start gap-3 rounded-lg border p-4" role="alert">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-red-300">{message}</p>
        {onRetry ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 min-h-[36px] text-red-300 hover:bg-red-500/10 hover:text-red-200"
            onClick={onRetry}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// Empty state
// ────────────────────────────────────────

function AdvancesEmptyState() {
  return (
    <div className="glass-empty-state flex flex-col items-center justify-center py-12">
      <AnimatedIllustration type="no-contracts" size="md" />
      <p className="mt-4 text-lg font-medium text-white/80">No advances yet</p>
      <p className="mt-1 max-w-xs text-center text-sm text-white/50">
        Request working capital against your awarded contracts to fund materials, labor, and other
        project costs.
      </p>
    </div>
  );
}

// ────────────────────────────────────────
// Main page
// ────────────────────────────────────────

export default function ProviderAdvancesPage() {
  const { data: advancesData, isLoading, isError, refetch } = useMyAdvances();
  const { data: contractsData } = useContracts({ status: 'active' });
  const requestAdvance = useRequestAdvance();

  const [selectedContract, setSelectedContract] = useState('');
  const [amountDollars, setAmountDollars] = useState('');

  const advances = advancesData?.advances ?? [];

  const totalAdvanced = advances.reduce((sum, a) => sum + a.advance_amount_cents, 0);
  const outstanding = advances
    .filter((a) => a.status === ADVANCE_STATUS.DISBURSED || a.status === ADVANCE_STATUS.REPAYING)
    .reduce((sum, a) => sum + (a.advance_amount_cents + a.fee_cents - a.repaid_cents), 0);

  const awardedContracts = contractsData?.contracts ?? [];
  const totalContractValue = awardedContracts.reduce((sum, c) => sum + c.amount_cents, 0);
  const availableCredit = Math.max(
    0,
    Math.round(totalContractValue * MAX_CREDIT_UTILIZATION) - outstanding,
  );

  /** Parse the dollar input to cents for fee preview */
  const requestAmountCents = useMemo(() => {
    const parsed = parseFloat(amountDollars);
    if (Number.isNaN(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * 100);
  }, [amountDollars]);

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

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Working Capital</h1>
          <p className="mt-1 text-white/50">
            Access working capital against your awarded contracts.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`skel-stat-${String(i)}`} className="glass rounded-xl p-5">
              <Skeleton className="mb-3 h-4 w-24" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          ))}
        </div>
        <div className="glass rounded-xl p-6">
          <Skeleton className="mb-4 h-5 w-36" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`skel-adv-${String(i)}`} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── Full-page error state ──
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Working Capital</h1>
          <p className="mt-1 text-white/50">
            Access working capital against your awarded contracts.
          </p>
        </div>
        <ErrorBanner
          message="Unable to load your advances. This may be a temporary issue."
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white/90">Working Capital</h1>
        <p className="mt-1 text-white/50">Access working capital against your awarded contracts.</p>
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

      {/* Credit explanation */}
      <CreditExplanation
        totalContractValue={totalContractValue}
        outstanding={outstanding}
        availableCredit={availableCredit}
      />

      {/* Request advance form */}
      <div className="glass glass-highlight rounded-xl">
        <div className="border-b border-white/5 px-5 py-4">
          <h2 className="text-base font-semibold text-white/80">Request Advance</h2>
        </div>
        <div className="p-5">
          <form onSubmit={handleRequestAdvance} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-select" className="text-white/60">
                  Contract
                </Label>
                <Select value={selectedContract} onValueChange={setSelectedContract}>
                  <SelectTrigger
                    id="contract-select"
                    className="min-h-[44px]"
                    aria-label="Select contract"
                  >
                    <SelectValue placeholder="Select a contract" />
                  </SelectTrigger>
                  <SelectContent>
                    {awardedContracts.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-white/40">
                        No active contracts available
                      </div>
                    ) : (
                      awardedContracts.map((contract) => (
                        <SelectItem key={contract.id} value={contract.id}>
                          {contract.contract_number} - {formatCents(contract.amount_cents)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="advance-amount" className="text-white/60">
                  Amount ($)
                </Label>
                <Input
                  id="advance-amount"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="0.00"
                  value={amountDollars}
                  onChange={(e) => {
                    setAmountDollars(e.target.value);
                  }}
                  className="min-h-[44px]"
                  aria-describedby={availableCredit > 0 ? 'advance-amount-hint' : undefined}
                />
                {availableCredit > 0 ? (
                  <p id="advance-amount-hint" className="text-xs text-white/30">
                    Up to {formatCents(availableCredit)} available
                  </p>
                ) : null}
              </div>
            </div>

            {/* Fee preview */}
            {requestAmountCents > 0 ? <FeePreview amountCents={requestAmountCents} /> : null}

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={
                  !selectedContract ||
                  !amountDollars ||
                  requestAmountCents <= 0 ||
                  requestAdvance.isPending
                }
              >
                {requestAdvance.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Request Advance
              </Button>
            </div>

            {/* Inline error with retry */}
            {requestAdvance.isError ? (
              <ErrorBanner
                message={getErrorMessage(requestAdvance.error)}
                onRetry={() => {
                  if (selectedContract && requestAmountCents > 0) {
                    requestAdvance.mutate({
                      contract_id: selectedContract,
                      advance_amount_cents: requestAmountCents,
                    });
                  }
                }}
              />
            ) : null}
          </form>
        </div>
      </div>

      {/* Advances list */}
      <div className="glass glass-highlight rounded-xl">
        <div className="border-b border-white/5 px-5 py-4">
          <h2 className="text-base font-semibold text-white/80">Advance History</h2>
        </div>
        <div className="p-5">
          {advances.length === 0 ? (
            <AdvancesEmptyState />
          ) : (
            <div className="space-y-2">
              {advances.map((advance: WorkingCapitalAdvance) => (
                <div
                  key={advance.id}
                  className="glass-interactive flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-white/80 tabular-nums">
                        {formatCents(advance.advance_amount_cents)}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn('text-xs', STATUS_CLASSES[advance.status])}
                      >
                        {STATUS_LABELS[advance.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-white/40">
                      {advance.contract_number ?? advance.contract_id.slice(0, 8)}
                      {' \u2022 '}
                      {formatDate(advance.created_at)}
                    </p>
                    {advance.fee_cents > 0 ? (
                      <p className="text-xs text-white/40">
                        Fee: {formatCents(advance.fee_cents)}
                        {advance.repaid_cents > 0
                          ? ` \u2022 Repaid: ${formatCents(advance.repaid_cents)}`
                          : ''}
                      </p>
                    ) : null}
                    {advance.rejection_reason ? (
                      <div className="mt-1 flex items-start gap-1.5">
                        <AlertCircle
                          className="mt-0.5 h-3 w-3 shrink-0 text-red-400"
                          aria-hidden="true"
                        />
                        <p className="text-xs text-red-300">{advance.rejection_reason}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
