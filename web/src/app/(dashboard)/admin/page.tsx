'use client';

import {
  AlertTriangle,
  Briefcase,
  CreditCard,
  DollarSign,
  Shield,
  Users,
} from 'lucide-react';

import { MetricsCard } from '@/components/admin/MetricsCard';
import { usePlatformMetrics } from '@/hooks/useAdmin';
import { formatCents } from '@/lib/utils';

export default function AdminOverviewPage() {
  const { data: metrics, isLoading } = usePlatformMetrics();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Overview</h1>
        <p className="mt-1 text-muted-foreground">
          Platform health at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricsCard
          label="Total Users"
          value={isLoading || !metrics ? '--' : String(metrics.total_users)}
          description={
            metrics
              ? `${String(metrics.active_users)} active, ${String(metrics.new_users)} new`
              : undefined
          }
          icon={Users}
          loading={isLoading}
        />
        <MetricsCard
          label="Active Jobs"
          value={isLoading || !metrics ? '--' : String(metrics.total_jobs_posted)}
          description={
            metrics
              ? `${String(metrics.total_jobs_completed)} completed, ${(metrics.job_fill_rate * 100).toFixed(1)}% fill rate`
              : undefined
          }
          icon={Briefcase}
          loading={isLoading}
        />
        <MetricsCard
          label="GMV"
          value={isLoading || !metrics ? '--' : formatCents(metrics.total_gmv_cents)}
          icon={DollarSign}
          loading={isLoading}
        />
        <MetricsCard
          label="Platform Revenue"
          value={isLoading || !metrics ? '--' : formatCents(metrics.total_revenue_cents)}
          description={
            metrics
              ? `${(metrics.effective_take_rate * 100).toFixed(1)}% take rate`
              : undefined
          }
          icon={CreditCard}
          loading={isLoading}
        />
        <MetricsCard
          label="Open Disputes"
          value={isLoading || !metrics ? '--' : String(metrics.disputes_opened)}
          description={
            metrics
              ? `${String(metrics.disputes_resolved)} resolved, ${(metrics.dispute_rate * 100).toFixed(2)}% rate`
              : undefined
          }
          icon={AlertTriangle}
          loading={isLoading}
        />
        <MetricsCard
          label="Guarantee Fund"
          value={
            isLoading || !metrics ? '--' : formatCents(metrics.total_guarantee_fund_cents)
          }
          description={
            metrics
              ? `${String(metrics.guarantee_claims)} claims, ${formatCents(metrics.guarantee_payouts_cents)} paid`
              : undefined
          }
          icon={Shield}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricsCard
          label="Total Bids"
          value={isLoading || !metrics ? '--' : String(metrics.total_bids)}
          loading={isLoading}
        />
        <MetricsCard
          label="Avg Bids per Job"
          value={
            isLoading || !metrics ? '--' : metrics.avg_bids_per_job.toFixed(1)
          }
          loading={isLoading}
        />
        <MetricsCard
          label="Job Completion Rate"
          value={
            isLoading || !metrics
              ? '--'
              : `${(metrics.job_completion_rate * 100).toFixed(1)}%`
          }
          loading={isLoading}
        />
        <MetricsCard
          label="Guarantee Payouts"
          value={
            isLoading || !metrics
              ? '--'
              : formatCents(metrics.guarantee_payouts_cents)
          }
          loading={isLoading}
        />
      </div>
    </div>
  );
}
