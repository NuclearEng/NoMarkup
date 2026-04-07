'use client';

import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Shield,
  Users,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { MetricsCard } from '@/components/admin/MetricsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { usePlatformMetrics } from '@/hooks/useAdmin';
import { formatCents } from '@/lib/utils';

interface AdminAction {
  label: string;
  description: string;
  href: Route;
  count?: number;
  urgent?: boolean;
}

function AdminQuickActions({ metrics }: { metrics: ReturnType<typeof usePlatformMetrics>['data'] }) {
  const actions: AdminAction[] = [
    {
      label: 'Pending Verifications',
      description: 'Review provider identity documents',
      href: '/admin/verification' as Route,
      urgent: true,
    },
    {
      label: 'Open Disputes',
      description: 'Disputes awaiting admin review',
      href: '/admin/disputes' as Route,
      count: metrics?.disputes_opened,
      urgent: (metrics?.disputes_opened ?? 0) > 0,
    },
    {
      label: 'Manage Taxonomy',
      description: 'Add or update service categories',
      href: '/admin/taxonomy' as Route,
    },
    {
      label: 'Platform Settings',
      description: 'Fee rates, limits, and feature flags',
      href: '/admin/platform' as Route,
    },
    {
      label: 'Guarantee Fund',
      description: 'Review claims and fund health',
      href: '/admin/guarantee' as Route,
    },
    {
      label: 'Fraud Review',
      description: 'Flagged accounts and suspicious activity',
      href: '/admin/fraud' as Route,
    },
  ];

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text text-base">Admin Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-white/[0.04]">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-white/[0.04]"
            >
              {action.urgent && (action.count ?? 0) > 0 ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-100">
                  {action.label}
                  {action.count !== undefined ? (
                    <span className="ml-2 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">
                      {String(action.count)}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-zinc-400">{action.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const { data: metrics, isLoading } = usePlatformMetrics();

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Admin Overview</h1>
        <p className="mt-1 text-zinc-300">
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

      <AdminQuickActions metrics={metrics} />
    </div>
    </PageTransition>
  );
}
