'use client';

import { useState } from 'react';
import { z } from 'zod';

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
  useRevenueReport,
  useUpdateFeeConfig,
} from '@/hooks/useAdmin';
import { PAYMENT_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn, formatCents } from '@/lib/utils';
import type { Payment } from '@/types';
import { PAYMENT_STATUS } from '@/types';

const ALL_FILTER = '__all__';

// Sentinel option that switches a preset dropdown into free-text mode so admins
// can enter a value outside the preset ladder (and aren't locked out of a value
// already configured that isn't on the list).
const CUSTOM_OPTION = '__custom__';

// Preset percentage ladders for the fee dropdowns. These are whole-number
// percents (matching what the admin types) and are reconciled with the Go
// DefaultFeeConfig() (services/payment/internal/domain/types.go): platform 5%,
// guarantee 2%, lead-gen 10% when enabled. The ladders bracket those defaults
// with the documented ranges (PRD: 5-8% take rate, 2-3% guarantee fund).
const PLATFORM_FEE_PRESETS = ['5', '8', '10', '12', '15'] as const;
const GUARANTEE_FEE_PRESETS = ['1', '2', '3'] as const;
const LEAD_GEN_FEE_PRESETS = ['0', '3', '5', '10'] as const;

// presetSelectValue maps the current raw string value to either a matching
// preset (so it shows selected) or the CUSTOM_OPTION sentinel. Empty stays
// empty so the placeholder renders.
function presetSelectValue(value: string, presets: readonly string[]): string {
  if (value === '') return '';
  return presets.includes(value) ? value : CUSTOM_OPTION;
}

// Validation for the fee form. Fields are kept as the raw string inputs the
// user types; we coerce + validate here so we can surface inline field errors
// before sending. Percentages are entered as whole numbers (e.g. "10.0") and
// dollar fields are entered in USD (converted to cents on submit).
const percentString = z
  .string()
  .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100), {
    message: 'Must be between 0 and 100',
  });

const usdString = z
  .string()
  .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), {
    message: 'Must be 0 or greater',
  });

const feeFormSchema = z
  .object({
    feePercentage: percentString,
    guaranteePercentage: percentString,
    minFee: usdString,
    maxFee: usdString,
    leadGenEnabled: z.boolean(),
    leadGenPercentage: percentString,
    leadGenMinFee: usdString,
    leadGenMaxFee: usdString,
  })
  .superRefine((val, ctx) => {
    // max >= min (when both provided) for the platform fee bounds.
    if (val.minFee !== '' && val.maxFee !== '' && Number(val.maxFee) < Number(val.minFee)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxFee'],
        message: 'Max fee must be ≥ min fee',
      });
    }
    // lead-gen max >= min (max is optional/empty = no cap).
    if (
      val.leadGenMinFee !== '' &&
      val.leadGenMaxFee !== '' &&
      Number(val.leadGenMaxFee) < Number(val.leadGenMinFee)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leadGenMaxFee'],
        message: 'Max fee must be ≥ min fee',
      });
    }
  });

type FeeFormErrors = Partial<Record<keyof z.infer<typeof feeFormSchema>, string>>;

// usdToCents matches the existing min/max fee conversion: USD → integer cents.
function usdToCents(value: string): number {
  return Math.round((parseFloat(value) || 0) * 100);
}

// pctToFraction converts a whole-number percent the admin types ("10" = 10%)
// into the 0..1 fraction the API/service expect (0.10). Rounded to 4 decimals
// to match the NUMERIC(5,4) precision of platform_fee_config.
function pctToFraction(value: string): number {
  return Math.round(((parseFloat(value) || 0) / 100) * 10000) / 10000;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface PercentPresetFieldProps {
  id: string;
  label: string;
  presets: readonly string[];
  /** Raw whole-number percent string (e.g. "10"). Empty = unset. */
  value: string;
  onValueChange: (next: string) => void;
  error?: string;
  /** Placeholder for the custom numeric input. */
  customPlaceholder: string;
}

// PercentPresetField renders a percentage fee as a dropdown of preset values
// plus a "Custom…" escape hatch that reveals a numeric input — so the standard
// rates are one click away, but admins are never locked out of an off-ladder
// value (including one already configured). The selected option reflects the
// current value: a matching preset shows selected, anything else shows
// "Custom…" with the numeric input pre-filled.
function PercentPresetField({
  id,
  label,
  presets,
  value,
  onValueChange,
  error,
  customPlaceholder,
}: PercentPresetFieldProps) {
  // customMode is sticky: once the admin picks "Custom…", the numeric input
  // stays visible even while empty (so they can type). It also auto-engages
  // when the incoming value is a non-empty off-ladder rate.
  const [customMode, setCustomMode] = useState(
    () => presetSelectValue(value, presets) === CUSTOM_OPTION,
  );
  const isCustom = customMode || presetSelectValue(value, presets) === CUSTOM_OPTION;
  const selectValue = isCustom ? CUSTOM_OPTION : value;
  const errorId = `${id}-error`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === CUSTOM_OPTION) {
            // Reveal the free-text input; clear so the admin types a fresh value.
            setCustomMode(true);
            onValueChange('');
            return;
          }
          // Picking a preset exits custom mode and sets the value directly.
          setCustomMode(false);
          onValueChange(next);
        }}
      >
        <SelectTrigger
          id={id}
          className="min-h-[44px]"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        >
          <SelectValue placeholder="Select a rate" />
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {preset}%
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_OPTION}>Custom…</SelectItem>
        </SelectContent>
      </Select>
      {isCustom ? (
        <Input
          aria-label={`${label} custom value`}
          type="number"
          step="0.01"
          min="0"
          max="100"
          placeholder={customPlaceholder}
          value={value}
          onChange={(e) => { onValueChange(e.target.value); }}
          className="min-h-[44px]"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function AdminPaymentsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  // Fee config form state
  const [feePercentage, setFeePercentage] = useState('');
  const [guaranteePercentage, setGuaranteePercentage] = useState('');
  const [minFeeCents, setMinFeeCents] = useState('');
  const [maxFeeCents, setMaxFeeCents] = useState('');
  const [feeCategoryId, setFeeCategoryId] = useState('');
  // Lead-gen fee form state.
  const [leadGenEnabled, setLeadGenEnabled] = useState(false);
  const [leadGenPercentage, setLeadGenPercentage] = useState('');
  const [leadGenMinFee, setLeadGenMinFee] = useState('');
  const [leadGenMaxFee, setLeadGenMaxFee] = useState('');
  const [feeErrors, setFeeErrors] = useState<FeeFormErrors>({});

  const { data: paymentsData, isLoading: paymentsLoading, isError: paymentsError } =
    useAdminPayments({
      status: statusFilter,
      page,
      page_size: 20,
    });

  const { data: revenueData, isLoading: revenueLoading } = useRevenueReport();
  const feeConfigMutation = useUpdateFeeConfig();

  async function handleSaveFees() {
    const parsed = feeFormSchema.safeParse({
      feePercentage,
      guaranteePercentage,
      minFee: minFeeCents,
      maxFee: maxFeeCents,
      leadGenEnabled,
      leadGenPercentage,
      leadGenMinFee,
      leadGenMaxFee,
    });

    if (!parsed.success) {
      const nextErrors: FeeFormErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !(field in nextErrors)) {
          nextErrors[field as keyof FeeFormErrors] = issue.message;
        }
      }
      setFeeErrors(nextErrors);
      return;
    }

    setFeeErrors({});
    await feeConfigMutation.mutateAsync({
      category_id: feeCategoryId,
      // Admins enter whole-number percents (e.g. "10" = 10%); the API/service
      // store fractions in 0..1, so convert here. pctToFraction("10") -> 0.10.
      fee_percentage: pctToFraction(feePercentage),
      guarantee_percentage: pctToFraction(guaranteePercentage),
      min_fee_cents: usdToCents(minFeeCents),
      max_fee_cents: usdToCents(maxFeeCents),
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

      {/* Fee Configuration */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text text-base">Fee Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="fee-category">Category ID (optional)</Label>
              <Input
                id="fee-category"
                placeholder="Leave blank for default"
                value={feeCategoryId}
                onChange={(e) => { setFeeCategoryId(e.target.value); }}
                className="min-h-[44px]"
              />
            </div>
            <PercentPresetField
              id="fee-percentage"
              label="Fee Percentage"
              presets={PLATFORM_FEE_PRESETS}
              value={feePercentage}
              onValueChange={setFeePercentage}
              error={feeErrors.feePercentage}
              customPlaceholder="e.g. 10.0"
            />
            <PercentPresetField
              id="guarantee-percentage"
              label="Guarantee Percentage"
              presets={GUARANTEE_FEE_PRESETS}
              value={guaranteePercentage}
              onValueChange={setGuaranteePercentage}
              error={feeErrors.guaranteePercentage}
              customPlaceholder="e.g. 2.0"
            />
            <div className="space-y-2">
              <Label htmlFor="min-fee">Min Fee (USD)</Label>
              <Input
                id="min-fee"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 1.00"
                value={minFeeCents}
                onChange={(e) => { setMinFeeCents(e.target.value); }}
                className="min-h-[44px]"
                aria-invalid={feeErrors.minFee ? true : undefined}
                aria-describedby={feeErrors.minFee ? 'min-fee-error' : undefined}
              />
              {feeErrors.minFee ? (
                <p id="min-fee-error" className="text-sm text-destructive">
                  {feeErrors.minFee}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-fee">Max Fee (USD)</Label>
              <Input
                id="max-fee"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 500.00"
                value={maxFeeCents}
                onChange={(e) => { setMaxFeeCents(e.target.value); }}
                className="min-h-[44px]"
                aria-invalid={feeErrors.maxFee ? true : undefined}
                aria-describedby={feeErrors.maxFee ? 'max-fee-error' : undefined}
              />
              {feeErrors.maxFee ? (
                <p id="max-fee-error" className="text-sm text-destructive">
                  {feeErrors.maxFee}
                </p>
              ) : null}
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
              />
            </div>

            {leadGenEnabled ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <PercentPresetField
                  id="lead-gen-percentage"
                  label="Lead-gen Percentage"
                  presets={LEAD_GEN_FEE_PRESETS}
                  value={leadGenPercentage}
                  onValueChange={setLeadGenPercentage}
                  error={feeErrors.leadGenPercentage}
                  customPlaceholder="e.g. 10.0"
                />
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
                    aria-invalid={feeErrors.leadGenMinFee ? true : undefined}
                    aria-describedby={
                      feeErrors.leadGenMinFee ? 'lead-gen-min-fee-error' : undefined
                    }
                  />
                  {feeErrors.leadGenMinFee ? (
                    <p id="lead-gen-min-fee-error" className="text-sm text-destructive">
                      {feeErrors.leadGenMinFee}
                    </p>
                  ) : null}
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
                    aria-invalid={feeErrors.leadGenMaxFee ? true : undefined}
                    aria-describedby={
                      feeErrors.leadGenMaxFee ? 'lead-gen-max-fee-error' : undefined
                    }
                  />
                  {feeErrors.leadGenMaxFee ? (
                    <p id="lead-gen-max-fee-error" className="text-sm text-destructive">
                      {feeErrors.leadGenMaxFee}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <Button
            className="min-h-[44px]"
            disabled={feeConfigMutation.isPending}
            onClick={() => { void handleSaveFees(); }}
          >
            {feeConfigMutation.isPending ? 'Saving...' : 'Save Fee Configuration'}
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
