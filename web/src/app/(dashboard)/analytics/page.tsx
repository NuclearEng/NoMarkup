'use client';

import { BarChart3, Clock, DollarSign, Star, TrendingUp, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EarningsChart } from '@/components/analytics/EarningsChart';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCustomerSpending,
  useProviderAnalytics,
  useProviderEarnings,
} from '@/hooks/useAnalytics';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

type DateRange = '30d' | '90d' | '1y' | 'all';

function getDateRange(range: DateRange): { startDate?: string; endDate?: string } {
  const now = new Date();
  const end = now.toISOString().split('T')[0];

  switch (range) {
    case '30d': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { startDate: start.toISOString().split('T')[0], endDate: end };
    }
    case '90d': {
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return { startDate: start.toISOString().split('T')[0], endDate: end };
    }
    case '1y': {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      return { startDate: start.toISOString().split('T')[0], endDate: end };
    }
    case 'all':
      return {};
  }
}

function getGroupBy(range: DateRange): string {
  switch (range) {
    case '30d':
      return 'week';
    case '90d':
      return 'month';
    case '1y':
    case 'all':
      return 'month';
  }
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  subValue?: string;
}

function MetricCard({ label, value, icon: Icon, subValue }: MetricCardProps) {
  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardContent className="flex items-center gap-4 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
          <Icon className="text-primary h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-zinc-300">{label}</p>
          <p className="text-lg font-bold">{value}</p>
          {subValue ? <p className="text-xs text-zinc-300">{subValue}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderAnalyticsView() {
  const [dateRange, setDateRange] = useState<DateRange>('90d');
  const { startDate, endDate } = useMemo(() => getDateRange(dateRange), [dateRange]);
  const groupBy = getGroupBy(dateRange);

  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
    refetch: refetchAnalytics,
  } = useProviderAnalytics(startDate, endDate);
  const { data: earnings, isLoading: earningsLoading } = useProviderEarnings(
    startDate,
    endDate,
    groupBy,
  );

  if (analyticsLoading || earningsLoading) {
    return (
      <div className="space-y-6">
        <ContentLoader preset="stat-card" count={4} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" />
      </div>
    );
  }

  if (analyticsError) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="error" size="md" />}
        title="Failed to load analytics"
        description="Something went wrong while fetching your analytics data. Please try again."
        action={
          <Button
            variant="default"
            className="min-h-[44px]"
            onClick={() => {
              void refetchAnalytics();
            }}
          >
            Retry
          </Button>
        }
        className="glass border-destructive/30"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex items-center justify-end">
        <Select
          value={dateRange}
          onValueChange={(val) => {
            setDateRange(val as DateRange);
          }}
        >
          <SelectTrigger className="min-h-[44px] w-[180px]" aria-label="Select date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="1y">Last year</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key metrics */}
      {analytics ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Win Rate"
              value={`${String(Math.round(analytics.win_rate * 100))}%`}
              icon={Trophy}
              subValue={`${String(analytics.bids_won)} of ${String(analytics.total_bids)} bids`}
            />
            <MetricCard
              label="On-Time Rate"
              value={`${String(Math.round(analytics.on_time_rate * 100))}%`}
              icon={Clock}
            />
            <MetricCard
              label="Completion Rate"
              value={`${String(Math.round(analytics.completion_rate * 100))}%`}
              icon={TrendingUp}
              subValue={`${String(analytics.jobs_completed)} completed`}
            />
            <MetricCard
              label="Average Rating"
              value={analytics.average_rating.toFixed(1)}
              icon={Star}
              subValue={`${String(analytics.total_reviews)} reviews`}
            />
          </div>

          {/* Secondary metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Total Earnings"
              value={formatCents(analytics.total_earnings_cents)}
              icon={DollarSign}
            />
            <MetricCard
              label="Average Job Value"
              value={formatCents(analytics.average_job_value_cents)}
              icon={BarChart3}
            />
            <MetricCard
              label="Avg Response Time"
              value={`${String(analytics.avg_response_time_minutes)} min`}
              icon={Clock}
            />
          </div>
        </>
      ) : null}

      {/* Earnings chart */}
      {earnings ? (
        <EarningsChart
          data={earnings.data_points}
          totalEarnings={earnings.total_earnings_cents}
          totalFees={earnings.total_fees_cents}
          netEarnings={earnings.net_earnings_cents}
          totalJobs={earnings.total_jobs}
        />
      ) : null}

      {/* Category breakdown */}
      {analytics && analytics.category_breakdown.length > 0 ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-lg">Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {/* Header */}
              <div className="hidden items-center gap-4 px-2 py-1 text-xs font-medium uppercase text-zinc-300 sm:flex">
                <div className="flex-1">Category</div>
                <div className="w-20 text-right">Jobs</div>
                <div className="w-28 text-right">Earnings</div>
                <div className="w-16 text-right">Rating</div>
              </div>

              <div className="glass-divider" role="separator" />

              {analytics.category_breakdown.map((cat) => (
                <div
                  key={cat.category_id}
                  className="hover:bg-white/[0.04] flex min-h-[44px] flex-col gap-1 rounded-md px-2 py-2 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex-1 text-sm font-medium">{cat.category_name}</div>
                  <div className="w-20 text-right text-sm tabular-nums">
                    {String(cat.jobs_completed)}
                  </div>
                  <div className="w-28 text-right text-sm font-semibold tabular-nums">
                    {formatCents(cat.total_earnings_cents)}
                  </div>
                  <div className="w-16 text-right">
                    <Badge variant="outline" className="text-xs tabular-nums">
                      {cat.average_rating.toFixed(1)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CustomerAnalyticsView() {
  const [dateRange, setDateRange] = useState<DateRange>('90d');
  const { startDate, endDate } = useMemo(() => getDateRange(dateRange), [dateRange]);
  const groupBy = getGroupBy(dateRange);

  const {
    data: spending,
    isLoading,
    isError,
    refetch,
  } = useCustomerSpending(startDate, endDate, groupBy);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <ContentLoader preset="stat-card" count={4} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="error" size="md" />}
        title="Failed to load spending data"
        description="Something went wrong while fetching your spending data. Please try again."
        action={
          <Button
            variant="default"
            className="min-h-[44px]"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        }
        className="glass border-destructive/30"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex items-center justify-end">
        <Select
          value={dateRange}
          onValueChange={(val) => {
            setDateRange(val as DateRange);
          }}
        >
          <SelectTrigger className="min-h-[44px] w-[180px]" aria-label="Select date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="1y">Last year</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key metrics */}
      {spending ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Spent"
              value={formatCents(spending.total_spent_cents)}
              icon={DollarSign}
            />
            <MetricCard label="Jobs Posted" value={String(spending.total_jobs)} icon={BarChart3} />
            <MetricCard
              label="Average Job Cost"
              value={formatCents(spending.average_job_cost_cents)}
              icon={TrendingUp}
            />
            <MetricCard
              label="Total Savings"
              value={formatCents(spending.total_savings_cents)}
              icon={Trophy}
              subValue="vs. market average"
            />
          </div>

          {/* Spending chart */}
          {spending.data_points.length > 0 ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardHeader>
                <CardTitle className="gold-text text-lg">Spending Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Bar chart using CSS */}
                <div className="space-y-2">
                  <div className="flex items-end gap-1" style={{ minHeight: '200px' }}>
                    {spending.data_points.map((point) => {
                      const maxAmount = Math.max(
                        ...spending.data_points.map((d) => d.amount_cents),
                        1,
                      );
                      const height = (point.amount_cents / maxAmount) * 100;

                      return (
                        <div
                          key={point.period_start}
                          className="group relative flex flex-1 flex-col items-center justify-end"
                          style={{ height: '200px' }}
                        >
                          {/* Tooltip */}
                          <div
                            className={cn(
                              'bg-popover pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border px-2 py-1 text-xs shadow-md',
                              'opacity-0 transition-opacity group-hover:opacity-100',
                            )}
                          >
                            <p className="font-semibold">
                              {new Date(point.period_start).toLocaleDateString('en-US', {
                                month: 'short',
                                year: '2-digit',
                              })}
                            </p>
                            <p>Spent: {formatCents(point.amount_cents)}</p>
                            <p>Jobs: {String(point.job_count)}</p>
                          </div>

                          <div
                            className="w-full rounded-t bg-[var(--brand-gold)] transition-all"
                            style={{ height: `${String(height)}%` }}
                            role="img"
                            aria-label={`${new Date(point.period_start).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}: ${formatCents(point.amount_cents)} spent on ${String(point.job_count)} jobs`}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* X-axis labels */}
                  <div className="flex gap-1">
                    {spending.data_points.map((point) => (
                      <div
                        key={point.period_start}
                        className="text-zinc-300 flex-1 text-center text-[10px]"
                      >
                        {new Date(point.period_start).toLocaleDateString('en-US', {
                          month: 'short',
                          year: '2-digit',
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Category breakdown */}
          {spending.category_breakdown.length > 0 ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardHeader>
                <CardTitle className="gold-text text-lg">Spending by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {/* Header */}
                  <div className="hidden items-center gap-4 px-2 py-1 text-xs font-medium uppercase text-zinc-300 sm:flex">
                    <div className="flex-1">Category</div>
                    <div className="w-20 text-right">Jobs</div>
                    <div className="w-28 text-right">Total Spent</div>
                  </div>

                  <div className="glass-divider" role="separator" />

                  {spending.category_breakdown.map((cat) => (
                    <div
                      key={cat.category_id}
                      className="hover:bg-white/[0.04] flex min-h-[44px] flex-col gap-1 rounded-md px-2 py-2 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex-1 text-sm font-medium">{cat.category_name}</div>
                      <div className="w-20 text-right text-sm tabular-nums">
                        {String(cat.job_count)}
                      </div>
                      <div className="w-28 text-right text-sm font-semibold tabular-nums">
                        {formatCents(cat.total_spent_cents)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function AnalyticsPage() {
  const user = useAuthStore((state) => state.user);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;

  return (
    <PageTransition>
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-1 text-zinc-300">
          {isProvider
            ? 'Track your performance, earnings, and growth.'
            : 'Track your spending, job activity, and savings.'}
        </p>
      </div>

      {isProvider ? <ProviderAnalyticsView /> : <CustomerAnalyticsView />}
    </div>
    </PageTransition>
  );
}
