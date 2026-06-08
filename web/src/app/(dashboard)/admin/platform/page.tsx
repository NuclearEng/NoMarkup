'use client';

import { useEffect, useState } from 'react';

import { MetricsCard } from '@/components/admin/MetricsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  useCategoryMetrics,
  useGrowthMetrics,
  usePlatformMetrics,
} from '@/hooks/useAdmin';
import { cn, formatCents } from '@/lib/utils';

const GROUP_BY_OPTIONS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
] as const;

// Analytics visibility preference persisted in localStorage per admin session.
const ANALYTICS_STORAGE_KEY = 'nomarkup_analytics_enabled';

function AnalyticsToggle() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(ANALYTICS_STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    localStorage.setItem(ANALYTICS_STORAGE_KEY, String(enabled));
  }, [enabled]);

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="font-medium">Enable analytics for all users</p>
          <p className="text-sm text-zinc-300">
            When enabled, all users will see analytics dashboards with spending/earnings data.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => { setEnabled(!enabled); }}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'min-h-[44px] min-w-[44px] items-center',
            enabled ? 'bg-[var(--brand-gold)]/70' : 'bg-white/10',
          )}
        >
          <span
            className={cn(
              'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </CardContent>
    </Card>
  );
}

export default function AdminPlatformPage() {
  const [groupBy, setGroupBy] = useState('month');

  const { data: metrics, isLoading: metricsLoading } = usePlatformMetrics();
  const { data: growth, isLoading: growthLoading } = useGrowthMetrics(
    undefined,
    undefined,
    groupBy,
  );
  const { data: categories, isLoading: categoriesLoading } = useCategoryMetrics();

  // Calculate max GMV for bar chart scaling
  const maxGmv =
    growth?.data_points.reduce(
      (max, dp) => Math.max(max, dp.gmv_cents),
      0,
    ) ?? 0;

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Platform Analytics</h1>
        <p className="mt-1 text-zinc-300">
          Comprehensive platform performance metrics and growth trends.
        </p>
      </div>

      {/* Analytics Toggle */}
      <AnalyticsToggle />

      <Separator />

      {/* Key Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricsCard
          label="Total Users"
          value={metricsLoading || !metrics ? '--' : String(metrics.total_users)}
          trend={growth?.user_growth_rate}
          loading={metricsLoading}
        />
        <MetricsCard
          label="Jobs Posted"
          value={metricsLoading || !metrics ? '--' : String(metrics.total_jobs_posted)}
          trend={growth?.job_growth_rate}
          loading={metricsLoading}
        />
        <MetricsCard
          label="Total GMV"
          value={metricsLoading || !metrics ? '--' : formatCents(metrics.total_gmv_cents)}
          trend={growth?.gmv_growth_rate}
          loading={metricsLoading}
        />
        <MetricsCard
          label="Avg Bids per Job"
          value={
            metricsLoading || !metrics ? '--' : metrics.avg_bids_per_job.toFixed(1)
          }
          loading={metricsLoading}
        />
      </div>

      {/* Growth Chart (CSS bars) */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="gold-text text-base">Growth Trends</CardTitle>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="w-[140px] min-h-[44px]" aria-label="Group by period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {growthLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            </div>
          ) : !growth || growth.data_points.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-zinc-300">
              No growth data available for the selected period.
            </div>
          ) : (
            <div className="space-y-4">
              {/* GMV Bars */}
              <div>
                <h3 className="mb-3 text-sm font-medium text-zinc-300">
                  GMV by Period
                </h3>
                <div className="space-y-2">
                  {growth.data_points.map((dp) => {
                    const percentage =
                      maxGmv > 0 ? (dp.gmv_cents / maxGmv) * 100 : 0;
                    const periodLabel = new Date(dp.period_start).toLocaleDateString(
                      'en-US',
                      { month: 'short', day: 'numeric' },
                    );
                    return (
                      <div key={dp.period_start} className="flex items-center gap-3">
                        <span className="w-20 whitespace-nowrap text-right text-xs text-zinc-300">
                          {periodLabel}
                        </span>
                        <div className="flex-1">
                          <div
                            className={cn(
                              'h-6 rounded bg-gradient-to-r from-[var(--brand-gold)]/30 to-[var(--brand-gold)]/70 transition-all',
                            )}
                            style={{ width: `${String(Math.max(percentage, 2))}%` }}
                            title={formatCents(dp.gmv_cents)}
                          />
                        </div>
                        <span className="w-24 text-right text-xs tabular-nums">
                          {formatCents(dp.gmv_cents)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary stats row */}
              <div className="flex flex-wrap gap-6 border-t pt-4">
                <div>
                  <span className="text-xs text-zinc-300">GMV Growth</span>
                  <p
                    className={cn(
                      'text-sm font-medium',
                      growth.gmv_growth_rate >= 0 ? 'text-emerald-400' : 'text-red-400',
                    )}
                  >
                    {growth.gmv_growth_rate >= 0 ? '+' : ''}
                    {(growth.gmv_growth_rate * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <span className="text-xs text-zinc-300">User Growth</span>
                  <p
                    className={cn(
                      'text-sm font-medium',
                      growth.user_growth_rate >= 0 ? 'text-emerald-400' : 'text-red-400',
                    )}
                  >
                    {growth.user_growth_rate >= 0 ? '+' : ''}
                    {(growth.user_growth_rate * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <span className="text-xs text-zinc-300">Job Growth</span>
                  <p
                    className={cn(
                      'text-sm font-medium',
                      growth.job_growth_rate >= 0 ? 'text-emerald-400' : 'text-red-400',
                    )}
                  >
                    {growth.job_growth_rate >= 0 ? '+' : ''}
                    {(growth.job_growth_rate * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category Performance Table */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text text-base">Category Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {categoriesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : !categories || categories.categories.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-300">
              No category data available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-white/[0.03]">
                    <th className="px-4 py-3 text-left font-medium text-white/40 uppercase text-xs tracking-wider">
                      Category
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-white/40 uppercase text-xs tracking-wider">
                      Jobs Posted
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-white/40 uppercase text-xs tracking-wider">
                      Jobs Completed
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-white/40 uppercase text-xs tracking-wider">
                      Total GMV
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-white/40 uppercase text-xs tracking-wider">
                      Avg Bid
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-white/40 uppercase text-xs tracking-wider">
                      Avg Bids/Job
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categories.categories.map((cat) => (
                    <tr key={cat.category_id} className="border-b border-white/5 hover:bg-white/[0.04]">
                      <td className="px-4 py-3 font-medium">{cat.category_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {String(cat.jobs_posted)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {String(cat.jobs_completed)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCents(cat.total_gmv_cents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCents(cat.avg_bid_cents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {cat.avg_bids_per_job.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </PageTransition>
  );
}
