'use client';

import { Briefcase, DollarSign, Gavel, Star } from 'lucide-react';
import Link from 'next/link';

import { EarningsChart } from '@/components/analytics/EarningsChart';
import { ProviderRankCard } from '@/components/providers/ProviderRankCard';
import { TrustScoreBreakdown } from '@/components/providers/TrustScoreBreakdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { useProviderAnalytics, useProviderEarnings } from '@/hooks/useAnalytics';
import { useMyBids } from '@/hooks/useBids';
import { useProviderProfile } from '@/hooks/useProviderProfile';
import { useTierRequirements, useTrustScore } from '@/hooks/useTrustScore';
import { formatCents } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

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
  icon: typeof Briefcase;
  loading: boolean;
}) {
  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-zinc-400 text-sm font-medium">{title}</CardTitle>
        <Icon className="text-zinc-400 h-4 w-4" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
        {description ? <p className="text-zinc-400 mt-1 text-xs">{description}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function ProviderDashboardPage() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? '';

  const { data: profile, isLoading: profileLoading } = useProviderProfile();
  const { data: analytics, isLoading: analyticsLoading } = useProviderAnalytics();
  const { data: earnings, isLoading: earningsLoading } = useProviderEarnings(
    undefined,
    undefined,
    'month',
  );
  const { data: bidsData, isLoading: bidsLoading } = useMyBids('active');
  const { data: trustData, isLoading: trustLoading } = useTrustScore(userId);
  const { data: tierData } = useTierRequirements();

  const isLoading = profileLoading || analyticsLoading;

  return (
    <PageTransition>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Provider Dashboard</h1>
          <p className="text-zinc-400">
            Manage your provider profile and track performance.
          </p>
        </div>
        <Link href="/provider/onboarding">
          <Button variant="outline" className="min-h-[44px]">
            Edit Profile
          </Button>
        </Link>
      </div>

      {/* Profile completeness */}
      {profile && profile.profileCompleteness < 100 ? (
        <Card className="glass glass-highlight border border-amber-500/20 bg-amber-500/10">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Complete your profile</p>
              <p className="text-zinc-400 text-sm">
                A complete profile helps you win more jobs. {String(profile.profileCompleteness)}%
                complete.
              </p>
              <Progress
                value={profile.profileCompleteness}
                className="mt-2 h-2"
                aria-label={`Profile ${String(profile.profileCompleteness)}% complete`}
              />
            </div>
            <Link href="/provider/onboarding">
              <Button size="sm" className="min-h-[44px]">
                Complete
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* Key metrics */}
      <div className="glass-divider" aria-hidden="true" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Bids"
          value={String(bidsData?.pagination.totalCount ?? 0)}
          description="Awaiting decision"
          icon={Gavel}
          loading={bidsLoading}
        />
        <StatCard
          title="Jobs Completed"
          value={String(analytics?.jobs_completed ?? 0)}
          description={
            analytics?.win_rate !== undefined
              ? `${(analytics.win_rate * 100).toFixed(0)}% win rate`
              : undefined
          }
          icon={Briefcase}
          loading={isLoading}
        />
        <StatCard
          title="Total Earnings"
          value={formatCents(analytics?.total_earnings_cents ?? 0)}
          description={
            analytics?.average_job_value_cents
              ? `Avg job: ${formatCents(analytics.average_job_value_cents)}`
              : undefined
          }
          icon={DollarSign}
          loading={isLoading}
        />
        <StatCard
          title="Avg Rating"
          value={analytics?.average_rating ? analytics.average_rating.toFixed(1) : '--'}
          description={
            analytics?.total_reviews
              ? `${String(analytics.total_reviews)} review${analytics.total_reviews !== 1 ? 's' : ''}`
              : 'No reviews yet'
          }
          icon={Star}
          loading={isLoading}
        />
      </div>

      {ENABLE_LIVE_AUCTION ? <ProviderRankCard /> : null}

      {/* Performance stats */}
      <div className="glass-divider" aria-hidden="true" />
      {analytics ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardContent className="p-4">
              <p className="text-zinc-400 text-sm font-medium">Win Rate</p>
              <p className="text-xl font-bold">{(analytics.win_rate * 100).toFixed(1)}%</p>
              <p className="text-zinc-400 text-xs">
                {String(analytics.bids_won)} won of {String(analytics.total_bids)} bids
              </p>
            </CardContent>
          </Card>
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardContent className="p-4">
              <p className="text-zinc-400 text-sm font-medium">On-Time Rate</p>
              <p className="text-xl font-bold">{(analytics.on_time_rate * 100).toFixed(1)}%</p>
              <p className="text-zinc-400 text-xs">
                Completion rate: {(analytics.completion_rate * 100).toFixed(0)}%
              </p>
            </CardContent>
          </Card>
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardContent className="p-4">
              <p className="text-zinc-400 text-sm font-medium">Avg Response Time</p>
              <p className="text-xl font-bold">
                {analytics.avg_response_time_minutes < 60
                  ? `${String(Math.round(analytics.avg_response_time_minutes))}m`
                  : `${String(Math.round(analytics.avg_response_time_minutes / 60))}h`}
              </p>
              <p className="text-zinc-400 text-xs">Time to first bid</p>
            </CardContent>
          </Card>
        </div>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`skel-perf-${String(i)}`} className="h-24" />
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Earnings chart */}
        {earnings ? (
          <EarningsChart
            data={earnings.data_points}
            totalEarnings={earnings.total_earnings_cents}
            totalFees={earnings.total_fees_cents}
            netEarnings={earnings.net_earnings_cents}
            totalJobs={earnings.total_jobs}
          />
        ) : earningsLoading ? (
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader>
              <CardTitle className="text-lg">Earnings Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-48 w-full" />
            </CardContent>
          </Card>
        ) : null}

        {/* Trust score */}
        {trustData?.score ? (
          <TrustScoreBreakdown score={trustData.score} tierRequirements={tierData?.tiers} />
        ) : trustLoading ? (
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader>
              <CardTitle className="text-lg">Trust Score</CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-48 w-full" />
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Recent active bids */}
      <div className="glass-divider" aria-hidden="true" />
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Active Bids</CardTitle>
          <Link href="/bids">
            <Button variant="ghost" size="sm" className="min-h-[44px]">
              View all
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {bidsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={`skel-bid-${String(i)}`} className="h-12 w-full" />
              ))}
            </div>
          ) : !bidsData?.bids.length ? (
            <div className="py-6 text-center">
              <p className="text-zinc-400 text-sm">No active bids.</p>
              <Link href="/jobs" className="mt-2 inline-block">
                <Button variant="outline" size="sm" className="min-h-[44px]">
                  Browse Jobs
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {bidsData.bids.slice(0, 5).map((bid) => (
                <Link
                  key={bid.id}
                  href={`/jobs/${bid.job_id}`}
                  className="hover:bg-muted/50 flex items-center justify-between rounded-md border p-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{formatCents(bid.amount_cents)}</p>
                    <p className="text-zinc-400 text-xs">
                      Placed{' '}
                      {new Date(bid.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {bid.status.replace(/_/g, ' ')}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </PageTransition>
  );
}
