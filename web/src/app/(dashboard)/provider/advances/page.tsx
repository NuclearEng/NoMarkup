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
import { useEffect, useMemo, useState } from 'react';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
// Card imports removed (unused)
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  useCreditLimit,
  useMyAdvances,
  useRepayAdvance,
  useRequestAdvance,
} from '@/hooks/useWorkingCapital';
import { cn, formatCents, repaymentProgress } from '@/lib/utils';
import type { AdvanceStatus, CreditLimit, WorkingCapitalAdvance } from '@/types';
import { ADVANCE_STATUS } from '@/types';

// ────────────────────────────────────────
// Constants
// ────────────────────────────────────────

/**
 * Annual percentage rate charged on working capital advances (3% APR).
 * Simple interest, prorated by term length (not compounded):
 *   fee = amount × APR × (termDays / 365)
 * Backend default term matches DEFAULT_TERM_DAYS below; keep them in sync.
 */
const FEE_APR = 0.03;
const DEFAULT_TERM_DAYS = 30;
// Flat origination/service fee on the principal, on top of APR interest.
// Mirrors domain.AdvanceServiceFeeRate in the payment service — keep in sync.
const SERVICE_FEE_RATE = 0.03;

/**
 * Credit-limit response with the risk-based pricing fields the gateway adds
 * (business credit score → grade → dynamic APR). Kept local so the shared
 * CreditLimit type stays minimal; fields are optional for older responses.
 */
type PricedCreditLimit = CreditLimit & {
  business_credit_score?: number;
  credit_grade?: string;
  base_rate_bps?: number;
  apr_bps?: number;
  eligible?: boolean;
};

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

function FeePreview({ amountCents, creditLimit }: { amountCents: number; creditLimit?: PricedCreditLimit }) {
  // Use the borrower's risk-based APR when the backend provides it; otherwise
  // fall back to the base rate. Pricing auto-adjusts to creditworthiness.
  const aprBps = creditLimit?.apr_bps ?? FEE_APR * 10000;
  const interestCents = Math.round((amountCents * aprBps * DEFAULT_TERM_DAYS) / 365 / 10000);
  const serviceFeeCents = Math.round(amountCents * SERVICE_FEE_RATE);
  const totalCents = amountCents + interestCents + serviceFeeCents;
  const aprPercent = (aprBps / 100).toFixed(2);
  const serviceFeePercent = (SERVICE_FEE_RATE * 100).toFixed(0);
  const score = creditLimit?.business_credit_score;
  const grade = creditLimit?.credit_grade;

  if (amountCents <= 0) return null;

  return (
    <div className="rounded-lg border border-[var(--brand-gold)]/10 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-white/70">
          <Info className="h-4 w-4 text-[var(--brand-gold)]" aria-hidden="true" />
          Fee Estimate
        </div>
        {score !== undefined && grade ? (
          <span
            className="rounded-md border border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--brand-gold)]"
            title="Your business credit score sets your rate"
          >
            Credit {grade} · {score}/100
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Advance amount</span>
          <span className="text-white/80 tabular-nums">{formatCents(amountCents)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">
            Interest ({aprPercent}% APR · ~{DEFAULT_TERM_DAYS}-day term)
          </span>
          <span className="text-white/80 tabular-nums">{formatCents(interestCents)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Service fee ({serviceFeePercent}%)</span>
          <span className="text-white/80 tabular-nums">{formatCents(serviceFeeCents)}</span>
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
        <p className="mt-2 text-xs text-white/40">
          Interest is charged at {aprPercent}% APR (set by your business credit score, prorated by
          days outstanding) plus a flat {serviceFeePercent}% service fee on the advance amount. No
          other fees.
        </p>
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
  // No headroom left to borrow (limit reached, or no limit at all) → show a
  // full bar, never a blank track next to "$0 available".
  const fullyUtilized = availableCredit <= 0;
  const utilizationPercent = fullyUtilized
    ? 100
    : maxCredit > 0
      ? Math.min(100, Math.round((outstanding / maxCredit) * 100))
      : 0;

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
                <span className="text-white/40">
                  {fullyUtilized ? 'Credit utilization — fully utilized' : 'Credit utilization'}
                </span>
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
                  aria-label={
                    fullyUtilized
                      ? 'Credit fully utilized: 100% used, $0 available'
                      : `Credit utilization: ${String(utilizationPercent)}% used`
                  }
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
// Outstanding-balance math (integer cents)
// ────────────────────────────────────────

/**
 * Outstanding balance on an advance = total owed (principal + fee) minus what
 * has already been repaid, in integer cents. Floored at 0 so a fully-repaid or
 * over-collected advance never reports a negative balance. This is the maximum
 * a manual repayment can be — the gateway 422s anything larger
 * ("Repayment amount exceeds the outstanding balance").
 */
export function outstandingCents(advance: WorkingCapitalAdvance): number {
  return Math.max(0, advance.advance_amount_cents + advance.fee_cents - advance.repaid_cents);
}

/** Statuses where a manual early repayment is allowed (still has a balance). */
function isRepayable(status: AdvanceStatus): boolean {
  return status === ADVANCE_STATUS.DISBURSED || status === ADVANCE_STATUS.REPAYING;
}

// ────────────────────────────────────────
// RepayDialog — manual early repayment
// ────────────────────────────────────────

function RepayDialog({
  advance,
  open,
  onOpenChange,
}: {
  advance: WorkingCapitalAdvance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repayAdvance = useRepayAdvance();
  const outstanding = outstandingCents(advance);
  const [amountDollars, setAmountDollars] = useState('');

  // Reset the field whenever the dialog (re)opens so a prior attempt doesn't
  // leak into the next one.
  useEffect(() => {
    if (open) setAmountDollars((outstanding / 100).toFixed(2));
  }, [open, outstanding]);

  const amountCents = useMemo(() => {
    const parsed = parseFloat(amountDollars);
    if (Number.isNaN(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * 100);
  }, [amountDollars]);

  const overBalance = amountCents > outstanding;
  const invalid = amountCents <= 0 || overBalance;

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (invalid || repayAdvance.isPending) return;

    repayAdvance.mutate(
      { advanceId: advance.id, amount_cents: amountCents },
      {
        onSuccess: () => {
          setAmountDollars('');
          onOpenChange(false);
        },
      },
    );
  }

  const ref = advance.contract_number ?? advance.contract_id.slice(0, 8);

  const fullyRepaid = outstanding <= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        glass-elevated (not bare `glass`): the elevated surface is more opaque
        and carries a stronger drop-shadow so the panel lifts clearly off the
        bg-black/80 overlay. The explicit bg-card is a hard floor — it guarantees
        an opaque surface even if backdrop-filter is unsupported, so the dialog
        can never render as a transparent "black highlighted screen" (the bug).
      */}
      <DialogContent className="glass-elevated max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="text-white/90">Repay advance</DialogTitle>
          <DialogDescription className="text-white/50">
            Pay down {ref} early to free up available credit. Enter any amount up to your outstanding
            balance.
          </DialogDescription>
        </DialogHeader>

        {/*
          Defensive empty state: if this advance has no outstanding balance
          (e.g. a concurrent repayment settled it while the dialog was open),
          render a clear, actionable message instead of a zero-amount form.
        */}
        {fullyRepaid ? (
          <div className="space-y-4">
            <div
              className="rounded-lg border border-white/5 bg-white/[0.02] p-4 text-sm text-white/60"
              role="status"
            >
              This advance is fully repaid — there is no remaining balance to pay down.
            </div>
            <DialogFooter>
              <Button
                type="button"
                className="min-h-[44px]"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
          {/* Outstanding summary — value is text + tabular, never color-only */}
          <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3 text-sm">
            <span className="text-white/50">Outstanding balance</span>
            <span className="gold-text font-semibold tabular-nums">{formatCents(outstanding)}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repay-amount" className="text-white/60">
              Repayment amount ($)
            </Label>
            <Input
              id="repay-amount"
              type="number"
              min="0.01"
              step="0.01"
              max={(outstanding / 100).toFixed(2)}
              placeholder="0.00"
              value={amountDollars}
              onChange={(e) => {
                setAmountDollars(e.target.value);
              }}
              className="min-h-[44px]"
              aria-describedby="repay-amount-hint"
              aria-invalid={overBalance || undefined}
            />
            {overBalance ? (
              <p id="repay-amount-hint" className="text-xs text-red-300" role="alert">
                Repayment amount exceeds the outstanding balance of {formatCents(outstanding)}.
              </p>
            ) : (
              <p id="repay-amount-hint" className="text-xs text-white/30">
                Up to {formatCents(outstanding)} can be repaid.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={repayAdvance.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-[44px]" disabled={invalid || repayAdvance.isPending}>
              {repayAdvance.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {amountCents > 0 && !overBalance ? `Repay ${formatCents(amountCents)}` : 'Repay'}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────
// Main page
// ────────────────────────────────────────

export default function ProviderAdvancesPage() {
  const { data: advancesData, isLoading, isError, refetch } = useMyAdvances();
  const { data: contractsData } = useContracts({ status: 'active' });
  const { data: creditLimitData } = useCreditLimit();
  const requestAdvance = useRequestAdvance();

  const [selectedContract, setSelectedContract] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  // Id of the advance whose Repay dialog is open (null = closed).
  const [repayAdvanceId, setRepayAdvanceId] = useState<string | null>(null);

  const advances = advancesData?.advances ?? [];

  const totalAdvanced = advances.reduce((sum, a) => sum + a.advance_amount_cents, 0);
  const outstanding = creditLimitData?.total_outstanding_cents ?? advances
    .filter((a) => a.status === ADVANCE_STATUS.DISBURSED || a.status === ADVANCE_STATUS.REPAYING)
    .reduce((sum, a) => sum + (a.advance_amount_cents + a.fee_cents - a.repaid_cents), 0);

  const awardedContracts = contractsData?.contracts ?? [];
  const totalContractValue = awardedContracts.reduce((sum, c) => sum + c.amount_cents, 0);
  const availableCredit = creditLimitData?.available_cents ?? Math.max(
    0,
    Math.round(totalContractValue * MAX_CREDIT_UTILIZATION) - outstanding,
  );
  const maxCredit = creditLimitData?.max_advance_cents ?? Math.round(totalContractValue * MAX_CREDIT_UTILIZATION);

  // Fully utilized = no available credit left. True both when outstanding has
  // reached the limit AND when there is no limit at all (maxCredit === 0). The
  // utilization bar must render FULL + clearly labeled in this state — a blank
  // track next to "$0 available" reads as broken (ISSUE: utilization bar bug).
  const fullyUtilized = availableCredit <= 0;
  const utilizationPercent = fullyUtilized
    ? 100
    : maxCredit > 0
      ? Math.min(100, Math.round((outstanding / maxCredit) * 100))
      : 0;

  /** Parse the dollar input to cents for fee preview */
  const requestAmountCents = useMemo(() => {
    const parsed = parseFloat(amountDollars);
    if (Number.isNaN(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * 100);
  }, [amountDollars]);

  function handleRequestAdvance(e: React.SyntheticEvent) {
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
        <div className="grid gap-4 md:grid-cols-3">
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
      <div className="grid gap-4 md:grid-cols-3">
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

      {/* Credit Limit Progress */}
      <div className="glass glass-highlight rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-white/70">Credit Utilization</p>
          <p className="text-sm text-white/50 tabular-nums">
            {formatCents(outstanding)} / {formatCents(maxCredit)}
          </p>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-white/5">
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
            aria-label={
              fullyUtilized
                ? 'Credit fully utilized: 100% used, $0 available'
                : `Credit utilization: ${String(utilizationPercent)}% used`
            }
          />
        </div>
        <p className="mt-2 text-xs text-white/40">
          {fullyUtilized
            ? `Fully utilized • ${formatCents(outstanding)} of ${formatCents(maxCredit)} used • $0 available`
            : `${formatCents(availableCredit)} available`}
        </p>
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
            {requestAmountCents > 0 ? (
              <FeePreview
                amountCents={requestAmountCents}
                creditLimit={creditLimitData as PricedCreditLimit | undefined}
              />
            ) : null}

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
                    {/* Repayment progress bar */}
                    {(advance.status === ADVANCE_STATUS.REPAYING ||
                      advance.status === ADVANCE_STATUS.DISBURSED ||
                      advance.status === ADVANCE_STATUS.REPAID) ? (() => {
                      const totalOwed = advance.advance_amount_cents + advance.fee_cents;
                      // Exact, transparent progress: rounds DOWN and never shows
                      // 100% / "Paid in full" unless the outstanding balance is
                      // truly $0.00 (e.g. an 8¢ shortfall renders as 99%, not 100%).
                      const { percent: repaymentPercent, outstandingCents: remainingCents, complete } =
                        repaymentProgress(advance.repaid_cents, totalOwed);
                      return (
                        <div className="mt-1.5 space-y-1">
                          <div className="flex items-center justify-between text-xs text-white/40">
                            <span>Repayment</span>
                            <span className="tabular-nums">
                              {complete ? 'Paid in full' : `${String(repaymentPercent)}%`}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all duration-500',
                                complete ? 'bg-emerald-500/60' : 'bg-[var(--brand-gold)]/60',
                              )}
                              style={{ width: `${String(repaymentPercent)}%` }}
                              role="progressbar"
                              aria-valuenow={advance.repaid_cents}
                              aria-valuemin={0}
                              aria-valuemax={totalOwed}
                              aria-label={
                                complete
                                  ? 'Repayment progress: paid in full'
                                  : `Repayment progress: ${String(repaymentPercent)}%, ${formatCents(remainingCents)} remaining`
                              }
                            />
                          </div>
                          {!complete && remainingCents > 0 ? (
                            <p className="text-xs text-white/40 tabular-nums">
                              {formatCents(remainingCents)} remaining
                            </p>
                          ) : null}
                        </div>
                      );
                    })() : null}
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

                  {/* Manual early-repayment action for outstanding advances */}
                  {isRepayable(advance.status) && outstandingCents(advance) > 0 ? (
                    <div className="ml-3 shrink-0 self-start">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        onClick={() => {
                          setRepayAdvanceId(advance.id);
                        }}
                        aria-label={`Repay advance ${
                          advance.contract_number ?? advance.contract_id.slice(0, 8)
                        } (${formatCents(outstandingCents(advance))} outstanding)`}
                      >
                        Repay
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Repay dialog — mounted per open advance; key resets internal state */}
      {repayAdvanceId
        ? (() => {
            const target = advances.find((a) => a.id === repayAdvanceId);
            if (!target) return null;
            return (
              <RepayDialog
                key={target.id}
                advance={target}
                open
                onOpenChange={(next) => {
                  if (!next) setRepayAdvanceId(null);
                }}
              />
            );
          })()
        : null}
    </div>
  );
}
