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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
      fee_percentage: parseFloat(feePercentage) || 0,
      guarantee_percentage: parseFloat(guaranteePercentage) || 0,
      min_fee_cents: usdToCents(minFeeCents),
      max_fee_cents: usdToCents(maxFeeCents),
      lead_gen_enabled: leadGenEnabled,
      lead_gen_percentage: parseFloat(leadGenPercentage) || 0,
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
      render: (payment) => (
        <span className="font-medium tabular-nums">
          {formatCents(payment.amount_cents)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Platform Fee',
      render: (payment) => (
        <span className="tabular-nums text-zinc-300">
          {formatCents(payment.platform_fee_cents)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
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
            <div className="space-y-2">
              <Label htmlFor="fee-percentage">Fee Percentage</Label>
              <Input
                id="fee-percentage"
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="e.g. 10.0"
                value={feePercentage}
                onChange={(e) => { setFeePercentage(e.target.value); }}
                className="min-h-[44px]"
                aria-invalid={feeErrors.feePercentage ? true : undefined}
                aria-describedby={feeErrors.feePercentage ? 'fee-percentage-error' : undefined}
              />
              {feeErrors.feePercentage ? (
                <p id="fee-percentage-error" className="text-sm text-destructive">
                  {feeErrors.feePercentage}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="guarantee-percentage">Guarantee Percentage</Label>
              <Input
                id="guarantee-percentage"
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="e.g. 2.0"
                value={guaranteePercentage}
                onChange={(e) => { setGuaranteePercentage(e.target.value); }}
                className="min-h-[44px]"
                aria-invalid={feeErrors.guaranteePercentage ? true : undefined}
                aria-describedby={
                  feeErrors.guaranteePercentage ? 'guarantee-percentage-error' : undefined
                }
              />
              {feeErrors.guaranteePercentage ? (
                <p id="guarantee-percentage-error" className="text-sm text-destructive">
                  {feeErrors.guaranteePercentage}
                </p>
              ) : null}
            </div>
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
                <div className="space-y-2">
                  <Label htmlFor="lead-gen-percentage">Lead-gen Percentage</Label>
                  <Input
                    id="lead-gen-percentage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g. 10.0"
                    value={leadGenPercentage}
                    onChange={(e) => { setLeadGenPercentage(e.target.value); }}
                    className="min-h-[44px]"
                    aria-invalid={feeErrors.leadGenPercentage ? true : undefined}
                    aria-describedby={
                      feeErrors.leadGenPercentage ? 'lead-gen-percentage-error' : undefined
                    }
                  />
                  {feeErrors.leadGenPercentage ? (
                    <p id="lead-gen-percentage-error" className="text-sm text-destructive">
                      {feeErrors.leadGenPercentage}
                    </p>
                  ) : null}
                </div>
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
