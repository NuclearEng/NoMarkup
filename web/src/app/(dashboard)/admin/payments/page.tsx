'use client';

import { useState } from 'react';

import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { MetricsCard } from '@/components/admin/MetricsCard';
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
import {
  useAdminPayments,
  useRevenueReport,
  useUpdateFeeConfig,
} from '@/hooks/useAdmin';
import { cn, formatCents } from '@/lib/utils';
import type { Payment } from '@/types';
import { PAYMENT_STATUS } from '@/types';

const ALL_FILTER = '__all__';

const PAYMENT_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  processing: 'bg-blue-100 text-blue-800 border-blue-200',
  escrow: 'bg-purple-100 text-purple-800 border-purple-200',
  released: 'bg-green-100 text-green-800 border-green-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
  refunded: 'bg-orange-100 text-orange-800 border-orange-200',
  disputed: 'bg-red-100 text-red-800 border-red-200',
};

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

  const { data: paymentsData, isLoading: paymentsLoading, isError: paymentsError } =
    useAdminPayments({
      status: statusFilter,
      page,
      page_size: 20,
    });

  const { data: revenueData, isLoading: revenueLoading } = useRevenueReport();
  const feeConfigMutation = useUpdateFeeConfig();

  async function handleSaveFees() {
    await feeConfigMutation.mutateAsync({
      category_id: feeCategoryId,
      fee_percentage: parseFloat(feePercentage) || 0,
      guarantee_percentage: parseFloat(guaranteePercentage) || 0,
      min_fee_cents: Math.round((parseFloat(minFeeCents) || 0) * 100),
      max_fee_cents: Math.round((parseFloat(maxFeeCents) || 0) * 100),
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
        <span className="tabular-nums text-muted-foreground">
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
        <span className="text-muted-foreground">{formatDate(payment.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payment Administration</h1>
        <p className="mt-1 text-muted-foreground">
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
        <h2 className="text-lg font-semibold">Transactions</h2>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Status:</span>
          <Select
            value={statusFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setStatusFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[180px] min-h-[44px]" aria-label="Filter payments by status">
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
          <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load payments. Please try refreshing the page.
          </div>
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fee Configuration</CardTitle>
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
              />
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
              />
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
                value={maxFeeCents}
                onChange={(e) => { setMaxFeeCents(e.target.value); }}
                className="min-h-[44px]"
              />
            </div>
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
  );
}
