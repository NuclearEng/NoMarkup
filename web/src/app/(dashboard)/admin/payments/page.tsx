'use client';

import { Lock, LockOpen, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { MetricsCard } from '@/components/admin/MetricsCard';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  useAdminPayments,
  useCreateCustomFee,
  useCustomFees,
  useDeleteCustomFee,
  useFeeConfig,
  useRevenueReport,
  useUpdateCustomFee,
  useUpdateFeeConfig,
} from '@/hooks/useAdmin';
import { getApiErrorMessage } from '@/lib/api';
import { PAYMENT_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn, formatCents } from '@/lib/utils';
import type { CustomFee, FeeConfigSummary, Payment } from '@/types';
import { PAYMENT_STATUS } from '@/types';

const ALL_FILTER = '__all__';

// Stepper increment per click and the bounds every percentage stepper is held
// to. Percentages are whole-number percents in the UI (e.g. 8 = 8%); the API
// stores 0..1 fractions, so we convert on submit (see pctToFraction).
const STEP_PERCENT = 0.5;
const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

// localStorage key for the client-side lock. Namespaced so it doesn't collide.
// Custom fees are persisted server-side (platform_custom_fees); lock is UI-only.
const LOCK_STORAGE_KEY = 'nm.admin.fees.locked';

// bpsToPercent converts integer basis points (500) into the whole-number
// percent the steppers operate on (5). Snapped to 2 decimals.
function bpsToPercent(bps: number): number {
  return Math.round((bps / 100) * 100) / 100;
}

// percentToBps converts a whole-number percent (5 = 5%) into integer basis
// points (500). Matches platform_custom_fees.rate_bps.
function percentToBps(percent: number): number {
  return Math.round(clampPercent(percent) * 100);
}

// clampPercent keeps a stepper value inside [MIN_PERCENT, MAX_PERCENT] and
// snaps to 2 decimals so repeated ±0.5 clicks never accumulate float drift.
function clampPercent(value: number): number {
  const bounded = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
  return Math.round(bounded * 100) / 100;
}

// usdToCents matches the existing min/max fee conversion: USD → integer cents.
function usdToCents(value: string): number {
  return Math.round((parseFloat(value) || 0) * 100);
}

// pctToFraction converts a whole-number percent the admin sees ("10" = 10%)
// into the 0..1 fraction the API/service expect (0.10). Rounded to 4 decimals
// to match the NUMERIC(5,4) precision of platform_fee_config.
function pctToFraction(value: number): number {
  return Math.round((value / 100) * 10000) / 10000;
}

// fractionToPercentNumber converts a stored 0..1 fraction (0.08) into the
// whole-number percent the steppers operate on (8). Snapped to 2 decimals.
function fractionToPercentNumber(fraction: number): number {
  return Math.round(fraction * 100 * 100) / 100;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// fractionToPercent renders a stored 0..1 fee fraction as a human percent
// (0.08 -> "8%"). Trailing zeros are trimmed so 0.025 -> "2.5%" but 0.08 -> "8%".
function fractionToPercent(fraction: number): string {
  const pct = fraction * 100;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded.toString()}%`;
}

// percentLabel renders a whole-number percent (8) as "8%", trimming trailing
// zeros (2.5 -> "2.5%", 8 -> "8%").
function percentLabel(value: number): string {
  return `${(Math.round(value * 100) / 100).toString()}%`;
}

// feeCapLabel renders a min/max cents bound as USD, or an em-dash when unset
// (0 or null = no cap configured).
function feeCapLabel(cents: number | null): string {
  return cents && cents > 0 ? formatCents(cents) : '—';
}

interface FeeSummaryRow {
  /** Stable key + cell label. */
  label: string;
  /** Right-aligned value (already formatted). */
  value: string;
  /** Audience/side hint shown muted under the label. */
  note: string;
  /** Optional badge rendered after the value (e.g. lead-gen enabled state). */
  badge?: { text: string; muted: boolean };
}

// CurrentFeesSummary is a READ-ONLY, at-a-glance view of the fees that are
// CURRENTLY ACTIVE — pulled live from the fetched fee config (GET, not the
// editable form below). It lets an admin confirm the live rates without
// interpreting the steppers. Reference rows (advance, instant payout) that live
// outside platform_fee_config are labelled as set elsewhere.
function CurrentFeesSummary({
  config,
  customFees,
  isLoading,
  isError,
}: {
  config: FeeConfigSummary | undefined;
  customFees: CustomFee[];
  isLoading: boolean;
  isError: boolean;
}) {
  const customRows: FeeSummaryRow[] = customFees
    .filter((f) => f.active)
    .map((f) => ({
      label: f.name,
      value: percentLabel(bpsToPercent(f.rate_bps)),
      note: 'Custom · seller-side',
    }));

  const rows: FeeSummaryRow[] = config
    ? [
        {
          label: 'Platform commission',
          value: fractionToPercent(config.fee_percentage),
          note: 'Seller-side',
        },
        {
          label: 'Guarantee (buyer protection)',
          value: fractionToPercent(config.guarantee_percentage),
          note: 'Seller-side',
        },
        {
          label: 'Lead-gen referral',
          value: fractionToPercent(config.lead_gen_percentage),
          note: 'Seller-side · opt-in',
          badge: config.lead_gen_enabled
            ? { text: 'Enabled', muted: false }
            : { text: 'Disabled', muted: true },
        },
        {
          label: 'Min fee cap',
          value: feeCapLabel(config.min_fee_cents),
          note: 'Floor per transaction',
        },
        {
          label: 'Max fee cap',
          value: feeCapLabel(config.max_fee_cents),
          note: 'Ceiling per transaction',
        },
        ...customRows,
      ]
    : [];

  // Static reference rows — NOT stored in platform_fee_config; set elsewhere.
  const referenceRows: FeeSummaryRow[] = [
    {
      label: 'Working-capital advance',
      value: '3% origination + 3–15% APR (risk-based)',
      note: 'Set elsewhere',
    },
    {
      label: 'Instant payout',
      value: '1%',
      note: 'Set elsewhere',
    },
  ];

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text text-base">Current Fees</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <p className="text-sm text-destructive">
            Could not load the active fee configuration. Please refresh to try again.
          </p>
        ) : isLoading || !config ? (
          <div className="space-y-3" role="status" aria-label="Loading fee configuration">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={`fee-skel-${String(i)}`} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">
              Currently active platform fees
            </caption>
            <thead>
              <tr className="border-b border-[var(--brand-gold)]/10 text-left text-xs uppercase tracking-wide text-zinc-300">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Fee
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Rate
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-[var(--brand-gold)]/5 last:border-b-0"
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium text-zinc-100">{row.label}</div>
                    <div className="text-xs text-zinc-400">{row.note}</div>
                  </td>
                  <td className="py-3 text-right align-top">
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-semibold tabular-nums text-zinc-100">
                        {row.value}
                      </span>
                      {row.badge ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs',
                            row.badge.muted
                              ? 'border-zinc-600 text-zinc-400'
                              : 'border-[var(--brand-gold)]/40 text-[var(--brand-gold)]',
                          )}
                        >
                          {row.badge.text}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tbody>
              <tr>
                <td colSpan={2} className="pt-4 pb-1">
                  <div className="text-xs uppercase tracking-wide text-zinc-400">
                    Other fees (set elsewhere)
                  </div>
                </td>
              </tr>
              {referenceRows.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-[var(--brand-gold)]/5 last:border-b-0"
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium text-zinc-100">{row.label}</div>
                    <div className="text-xs text-zinc-400">{row.note}</div>
                  </td>
                  <td className="py-3 text-right align-top">
                    <span className="font-semibold tabular-nums text-zinc-100 break-words">
                      {row.value}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-xs text-zinc-400">
          The buyer/customer pays no markup — fees come out of the seller payout.
        </p>
      </CardContent>
    </Card>
  );
}

interface FeeStepperProps {
  id: string;
  label: string;
  /** Short audience/side hint shown muted under the label. */
  note?: string;
  /** Current whole-number percent value (e.g. 8 = 8%). */
  value: number;
  onValueChange: (next: number) => void;
  disabled?: boolean;
  /** Optional trailing control (e.g. a remove button for custom fees). */
  trailing?: React.ReactNode;
}

// FeeStepper adjusts a single percentage fee up/down via −/+ buttons, with the
// current value shown between them. Bounds are enforced (0–100%), each click is
// ±STEP_PERCENT, and the value is keyboard-adjustable (ArrowUp/ArrowDown,
// PageUp/PageDown) via a focusable spinbutton region. Disabled = locked.
function FeeStepper({
  id,
  label,
  note,
  value,
  onValueChange,
  disabled = false,
  trailing,
}: FeeStepperProps) {
  function step(delta: number) {
    onValueChange(clampPercent(value + delta));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(STEP_PERCENT);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-STEP_PERCENT);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      step(STEP_PERCENT * 2);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      step(-STEP_PERCENT * 2);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-[var(--brand-gold)]/10 p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium text-zinc-100">
          {label}
        </Label>
        {note ? <p className="text-xs text-zinc-400">{note}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1 rounded-md border border-[var(--brand-gold)]/15 bg-zinc-900/40 p-1"
          role="group"
          aria-label={`${label} stepper`}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={() => { step(-STEP_PERCENT); }}
            disabled={disabled || value <= MIN_PERCENT}
            aria-label={`Decrease ${label} by ${STEP_PERCENT.toString()}%`}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div
            id={id}
            role="spinbutton"
            tabIndex={disabled ? -1 : 0}
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={MIN_PERCENT}
            aria-valuemax={MAX_PERCENT}
            aria-valuetext={percentLabel(value)}
            aria-disabled={disabled || undefined}
            onKeyDown={handleKeyDown}
            className={cn(
              'min-w-[4rem] select-none rounded-sm px-2 text-center text-base font-semibold tabular-nums text-zinc-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900',
              disabled && 'text-zinc-500',
            )}
          >
            {percentLabel(value)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={() => { step(STEP_PERCENT); }}
            disabled={disabled || value >= MAX_PERCENT}
            aria-label={`Increase ${label} by ${STEP_PERCENT.toString()}%`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {trailing}
      </div>
    </div>
  );
}

interface CustomFeesSectionProps {
  fees: CustomFee[];
  isLoading: boolean;
  isError: boolean;
  locked: boolean;
  mutating: boolean;
  mutationError: string | null;
  onChangeRate: (id: string, ratePercent: number) => void;
  onRemove: (id: string) => void;
  onAdd: (name: string, rateBps: number) => Promise<void>;
}

// CustomFeesSection lists admin-defined custom fees (each with the same up/down
// stepper) plus a small "add fee" form. Fees persist via
// /api/v1/admin/custom-fees and are applied on live CalculateFees.
function CustomFeesSection({
  fees,
  isLoading,
  isError,
  locked,
  mutating,
  mutationError,
  onChangeRate,
  onRemove,
  onAdd,
}: CustomFeesSectionProps) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState('');

  async function handleAdd() {
    const trimmed = name.trim();
    const parsed = Number(rate);
    if (trimmed === '') {
      setError('Enter a fee name.');
      return;
    }
    if (rate === '' || Number.isNaN(parsed) || parsed < MIN_PERCENT || parsed > MAX_PERCENT) {
      setError('Default % must be between 0 and 100.');
      return;
    }
    setError('');
    await onAdd(trimmed, percentToBps(parsed));
    setName('');
    setRate('');
  }

  return (
    <div className="space-y-4 rounded-md border border-[var(--brand-gold)]/10 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-zinc-100">Custom fees</h3>
        <p className="text-xs text-zinc-400">
          Named fees applied on top of the platform commission. Combined
          platform + custom take is capped at 50%.
        </p>
      </div>

      {isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load custom fees. Please refresh to try again.
        </p>
      ) : isLoading ? (
        <div className="space-y-3" role="status" aria-label="Loading custom fees">
          {[0, 1].map((i) => (
            <Skeleton key={`custom-fee-skel-${String(i)}`} className="h-14 w-full" />
          ))}
        </div>
      ) : fees.length > 0 ? (
        <div className="space-y-3">
          {fees.map((fee) => (
            <FeeStepper
              key={fee.id}
              id={`custom-fee-${fee.id}`}
              label={fee.name}
              note={fee.active ? 'Custom · live' : 'Custom · inactive'}
              value={bpsToPercent(fee.rate_bps)}
              onValueChange={(next) => { onChangeRate(fee.id, next); }}
              disabled={locked || mutating}
              trailing={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] text-destructive hover:text-destructive"
                  onClick={() => { onRemove(fee.id); }}
                  disabled={locked || mutating}
                  aria-label={`Remove ${fee.name} fee`}
                >
                  Remove
                </Button>
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">No custom fees yet.</p>
      )}

      {locked ? null : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="custom-fee-name">Name</Label>
            <Input
              id="custom-fee-name"
              placeholder="e.g. Featured listing"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className="min-h-[44px]"
              disabled={mutating}
              aria-invalid={error !== '' && name.trim() === '' ? true : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-fee-rate">Default %</Label>
            <Input
              id="custom-fee-rate"
              type="number"
              step="0.5"
              min="0"
              max="100"
              placeholder="e.g. 5"
              value={rate}
              onChange={(e) => { setRate(e.target.value); }}
              className="min-h-[44px] sm:w-28"
              disabled={mutating}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => { void handleAdd(); }}
            disabled={mutating}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Add fee
          </Button>
        </div>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {mutationError ? (
        <p className="text-sm text-destructive" role="alert">
          {mutationError}
        </p>
      ) : null}
    </div>
  );
}

export default function AdminPaymentsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  // Fee config form state — percentages are whole-number percents (8 = 8%) the
  // steppers operate on; min/max are USD strings, converted to cents on submit.
  const [feePercentage, setFeePercentage] = useState(0);
  const [guaranteePercentage, setGuaranteePercentage] = useState(0);
  const [minFee, setMinFee] = useState('');
  const [maxFee, setMaxFee] = useState('');
  const [feeCategoryId, setFeeCategoryId] = useState('');
  // Lead-gen fee form state.
  const [leadGenEnabled, setLeadGenEnabled] = useState(false);
  const [leadGenPercentage, setLeadGenPercentage] = useState(0);
  const [leadGenMinFee, setLeadGenMinFee] = useState('');
  const [leadGenMaxFee, setLeadGenMaxFee] = useState('');

  // Lock state — when locked the steppers are read-only. Persisted to
  // localStorage so a lock survives reloads (client-side only; no backend field).
  const [locked, setLocked] = useState(false);
  // Seed the form from live config exactly once it arrives (and not again, so
  // in-progress stepper edits aren't clobbered by a refetch).
  const [seeded, setSeeded] = useState(false);

  const { data: paymentsData, isLoading: paymentsLoading, isError: paymentsError } =
    useAdminPayments({
      status: statusFilter,
      page,
      page_size: 20,
    });

  const { data: revenueData, isLoading: revenueLoading } = useRevenueReport();
  // Live, read-only view of the currently active platform fees. Backs the
  // "Current Fees" summary above and seeds the editable steppers below.
  const {
    data: feeConfig,
    isLoading: feeConfigLoading,
    isError: feeConfigError,
  } = useFeeConfig();
  const feeConfigMutation = useUpdateFeeConfig();
  const {
    data: customFeesData,
    isLoading: customFeesLoading,
    isError: customFeesError,
  } = useCustomFees();
  const createCustomFee = useCreateCustomFee();
  const updateCustomFee = useUpdateCustomFee();
  const deleteCustomFee = useDeleteCustomFee();
  const customFees = customFeesData?.fees ?? [];

  // Hydrate lock from localStorage on mount (client-only).
  useEffect(() => {
    try {
      setLocked(window.localStorage.getItem(LOCK_STORAGE_KEY) === 'true');
    } catch {
      // Corrupt/unavailable storage — fall back to defaults silently.
    }
  }, []);

  // Seed the steppers from the live config once it loads (fractions → percent).
  useEffect(() => {
    if (feeConfig && !seeded) {
      setFeePercentage(fractionToPercentNumber(feeConfig.fee_percentage));
      setGuaranteePercentage(fractionToPercentNumber(feeConfig.guarantee_percentage));
      setMinFee(feeConfig.min_fee_cents > 0 ? (feeConfig.min_fee_cents / 100).toString() : '');
      setMaxFee(feeConfig.max_fee_cents > 0 ? (feeConfig.max_fee_cents / 100).toString() : '');
      setLeadGenEnabled(feeConfig.lead_gen_enabled);
      setLeadGenPercentage(fractionToPercentNumber(feeConfig.lead_gen_percentage));
      setLeadGenMinFee(
        feeConfig.lead_gen_min_fee_cents > 0
          ? (feeConfig.lead_gen_min_fee_cents / 100).toString()
          : '',
      );
      setLeadGenMaxFee(
        feeConfig.lead_gen_max_fee_cents && feeConfig.lead_gen_max_fee_cents > 0
          ? (feeConfig.lead_gen_max_fee_cents / 100).toString()
          : '',
      );
      setSeeded(true);
    }
  }, [feeConfig, seeded]);

  function toggleLock() {
    const next = !locked;
    setLocked(next);
    try {
      window.localStorage.setItem(LOCK_STORAGE_KEY, String(next));
    } catch {
      // Storage unavailable — lock stays in-memory for this session.
    }
  }

  async function handleAddCustomFee(name: string, rateBps: number) {
    await createCustomFee.mutateAsync({ name, rate_bps: rateBps });
  }

  function handleChangeCustomRate(id: string, ratePercent: number) {
    void updateCustomFee.mutateAsync({ id, rate_bps: percentToBps(ratePercent) });
  }

  function handleRemoveCustomFee(id: string) {
    void deleteCustomFee.mutateAsync(id);
  }

  const customFeeMutationError =
    createCustomFee.isError || updateCustomFee.isError || deleteCustomFee.isError
      ? getApiErrorMessage(
          createCustomFee.error ?? updateCustomFee.error ?? deleteCustomFee.error,
          'Failed to update custom fee. Please try again.',
        )
      : null;
  const customFeeMutating =
    createCustomFee.isPending || updateCustomFee.isPending || deleteCustomFee.isPending;

  async function handleSaveFees() {
    await feeConfigMutation.mutateAsync({
      category_id: feeCategoryId,
      // The steppers hold whole-number percents (8 = 8%); the API/service store
      // 0..1 fractions, so convert here. pctToFraction(8) -> 0.08.
      fee_percentage: pctToFraction(feePercentage),
      guarantee_percentage: pctToFraction(guaranteePercentage),
      min_fee_cents: usdToCents(minFee),
      max_fee_cents: usdToCents(maxFee),
      lead_gen_enabled: leadGenEnabled,
      lead_gen_percentage: pctToFraction(leadGenPercentage),
      lead_gen_min_fee_cents: usdToCents(leadGenMinFee),
      // Optional cap — null (no cap) when the field is left blank.
      lead_gen_max_fee_cents: leadGenMaxFee === '' ? null : usdToCents(leadGenMaxFee),
    });
  }

  const columns: Column<Payment>[] = [
    {
      key: 'id',
      header: 'Payment ID',
      render: (payment) => (
        <span className="font-mono text-xs">{payment.id.slice(0, 12)}...</span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'whitespace-nowrap',
      render: (payment) => (
        <span className="font-medium tabular-nums">
          {formatCents(payment.amount_cents)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Platform Fee',
      className: 'whitespace-nowrap',
      render: (payment) => (
        <span className="tabular-nums text-zinc-300">
          {formatCents(payment.platform_fee_cents)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      render: (payment) => (
        <Badge
          variant="outline"
          className={cn('text-xs', PAYMENT_STATUS_CLASSES[payment.status] ?? '')}
        >
          {payment.status.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Date',
      className: 'whitespace-nowrap',
      render: (payment) => (
        <span className="text-zinc-300">{formatDate(payment.created_at)}</span>
      ),
    },
  ];

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Payment Administration</h1>
        <p className="mt-1 text-zinc-300">
          Revenue overview, transaction management, and fee configuration.
        </p>
      </div>

      {/* Revenue Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricsCard
          label="Total GMV"
          value={revenueLoading || !revenueData ? '--' : formatCents(revenueData.total_gmv_cents)}
          loading={revenueLoading}
        />
        <MetricsCard
          label="Platform Revenue"
          value={
            revenueLoading || !revenueData
              ? '--'
              : formatCents(revenueData.total_revenue_cents)
          }
          loading={revenueLoading}
        />
        <MetricsCard
          label="Guarantee Fund"
          value={
            revenueLoading || !revenueData
              ? '--'
              : formatCents(revenueData.total_guarantee_fund_cents)
          }
          loading={revenueLoading}
        />
        <MetricsCard
          label="Effective Take Rate"
          value={
            revenueLoading || !revenueData
              ? '--'
              : `${(revenueData.effective_take_rate * 100).toFixed(2)}%`
          }
          loading={revenueLoading}
        />
      </div>

      {/* Transactions Table */}
      <div className="space-y-4">
        <h2 className="gold-text text-lg font-semibold">Transactions</h2>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-300">Status:</span>
          <Select
            value={statusFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setStatusFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full min-h-[44px] sm:w-[180px]" aria-label="Filter payments by status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
              {Object.entries(PAYMENT_STATUS).map(([key, value]) => (
                <SelectItem key={key} value={value}>
                  {value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {paymentsError ? (
          <EmptyState
            icon={<AnimatedIllustration type="error" size="sm" />}
            title="Failed to load payments"
            description="Please try refreshing the page."
          />
        ) : (
          <DataTable
            columns={columns}
            data={paymentsData?.payments ?? []}
            rowKey={(payment) => payment.id}
            pagination={paymentsData?.pagination}
            page={page}
            onPageChange={setPage}
            loading={paymentsLoading}
            emptyMessage="No payments found matching the current filters."
          />
        )}
      </div>

      {/* Current Fees — read-only summary of the live, active rates */}
      <CurrentFeesSummary
        config={feeConfig}
        customFees={customFees}
        isLoading={feeConfigLoading}
        isError={feeConfigError}
      />

      {/* Fee Configuration — stepper-driven editor */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="gold-text text-base">Fee Configuration</CardTitle>
            <div className="flex items-center gap-2">
              {locked ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 text-amber-300"
                >
                  <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                  Locked
                </Badge>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[40px] text-foreground"
                onClick={toggleLock}
                aria-pressed={locked}
              >
                {locked ? (
                  <>
                    <LockOpen className="mr-1 h-4 w-4" aria-hidden="true" />
                    Unlock
                  </>
                ) : (
                  <>
                    <Lock className="mr-1 h-4 w-4" aria-hidden="true" />
                    Lock Configuration
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {locked ? (
            <p className="text-sm text-amber-300" role="status">
              Configuration is locked. Unlock to adjust fees.
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="fee-category">Category ID (optional)</Label>
            <Input
              id="fee-category"
              placeholder="Leave blank for default"
              value={feeCategoryId}
              onChange={(e) => { setFeeCategoryId(e.target.value); }}
              className="min-h-[44px] sm:max-w-sm"
              disabled={locked}
            />
          </div>

          <div className="space-y-3">
            <FeeStepper
              id="fee-percentage"
              label="Platform commission"
              note="Seller-side · core take rate"
              value={feePercentage}
              onValueChange={setFeePercentage}
              disabled={locked}
            />
            <FeeStepper
              id="guarantee-percentage"
              label="Guarantee (buyer protection)"
              note="Seller-side · guarantee fund"
              value={guaranteePercentage}
              onValueChange={setGuaranteePercentage}
              disabled={locked}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="min-fee">Min Fee (USD)</Label>
              <Input
                id="min-fee"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 1.00"
                value={minFee}
                onChange={(e) => { setMinFee(e.target.value); }}
                className="min-h-[44px]"
                disabled={locked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-fee">Max Fee (USD)</Label>
              <Input
                id="max-fee"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 500.00"
                value={maxFee}
                onChange={(e) => { setMaxFee(e.target.value); }}
                className="min-h-[44px]"
                disabled={locked}
              />
            </div>
          </div>

          {/* Lead-gen fee — additive fee on won contracts */}
          <div className="space-y-4 rounded-md border border-[var(--brand-gold)]/10 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="lead-gen-enabled" className="text-base">
                  Lead-gen fee
                </Label>
                <p className="text-sm text-zinc-300">
                  An <span className="font-medium">additive</span> fee charged on won
                  contracts, on top of the platform and guarantee fees. It covers the cost
                  of sourcing the lead.
                </p>
              </div>
              <Switch
                id="lead-gen-enabled"
                checked={leadGenEnabled}
                onCheckedChange={setLeadGenEnabled}
                aria-label="Enable lead-gen fee"
                disabled={locked}
              />
            </div>

            {leadGenEnabled ? (
              <div className="space-y-3">
                <FeeStepper
                  id="lead-gen-percentage"
                  label="Lead-gen referral"
                  note="Seller-side · per won contract"
                  value={leadGenPercentage}
                  onValueChange={setLeadGenPercentage}
                  disabled={locked}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="lead-gen-min-fee">Lead-gen Min Fee (USD)</Label>
                    <Input
                      id="lead-gen-min-fee"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 5.00"
                      value={leadGenMinFee}
                      onChange={(e) => { setLeadGenMinFee(e.target.value); }}
                      className="min-h-[44px]"
                      disabled={locked}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lead-gen-max-fee">Lead-gen Max Fee (USD, optional)</Label>
                    <Input
                      id="lead-gen-max-fee"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Leave blank for no cap"
                      value={leadGenMaxFee}
                      onChange={(e) => { setLeadGenMaxFee(e.target.value); }}
                      className="min-h-[44px]"
                      disabled={locked}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <CustomFeesSection
            fees={customFees}
            isLoading={customFeesLoading}
            isError={customFeesError}
            locked={locked}
            mutating={customFeeMutating}
            mutationError={customFeeMutationError}
            onChangeRate={handleChangeCustomRate}
            onRemove={handleRemoveCustomFee}
            onAdd={handleAddCustomFee}
          />

          <Button
            className="min-h-[44px]"
            disabled={feeConfigMutation.isPending || locked}
            onClick={() => { void handleSaveFees(); }}
          >
            {feeConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </Button>

          {feeConfigMutation.isError ? (
            <p className="text-sm text-destructive">
              Failed to update fee configuration. Please try again.
            </p>
          ) : null}

          {feeConfigMutation.isSuccess ? (
            <p className="text-sm text-green-600">
              Fee configuration updated successfully.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
    </PageTransition>
  );
}
