'use client';

import {
  Briefcase,
  CheckCircle2,
  Circle,
  DollarSign,
  FileText,
  Gavel,
  Plus,
  Search,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { useCountUp } from '@/hooks/useCountUp';
import { useProfile } from '@/hooks/useProfile';
import { SavingsTracker } from '@/components/dashboard/SavingsTracker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContentLoader } from '@/components/ui/content-loader';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { TrendArrow } from '@/components/ui/trend-arrow';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { useCustomerSpending, useProviderEarnings } from '@/hooks/useAnalytics';
import { useMyBids } from '@/hooks/useBids';
import { useContracts } from '@/hooks/useContracts';
import { useCustomerJobs } from '@/hooks/useJobs';
import { usePayments } from '@/hooks/usePayments';
import { cn, formatCents } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

/** Glass tint removed — all stat cards use the same uniform background */
const STAT_GLASS_TINT: Record<string, string> = {};

function StatCard({
  title,
  value,
  numericValue,
  isCurrency,
  description,
  icon: Icon,
  loading,
  sparklineData,
  trendValue,
  trendLabel,
}: {
  title: string;
  value: string;
  numericValue?: number;
  isCurrency?: boolean;
  description?: string;
  icon: LucideIcon;
  loading: boolean;
  sparklineData?: number[];
  trendValue?: number;
  trendLabel?: string;
}) {
  // Count-up animation for the numeric value
  const animatedNum = useCountUp(loading ? 0 : (numericValue ?? 0));
  const displayValue = loading
    ? ''
    : numericValue !== undefined
      ? isCurrency
        ? formatCents(animatedNum)
        : String(animatedNum)
      : value;

  const glassTintClass = STAT_GLASS_TINT[Icon.displayName ?? ''] ?? '';

  return (
    <Card
      className={cn(
        'glass glass-highlight glass-refraction relative overflow-hidden border border-[var(--brand-gold)]/10',
        glassTintClass,
      )}
    >
      <CardHeader className="relative z-[2] flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-zinc-300">{title}</CardTitle>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.06]">
          <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="relative z-[2]">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p
                className="animate-count-up-fade text-2xl font-bold tracking-tight text-zinc-100 tabular-nums"
                style={isCurrency ? { textShadow: '0 0 16px rgba(16,185,129,0.2)' } : undefined}
              >
                {displayValue}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                {trendValue !== undefined ? (
                  <TrendArrow value={trendValue} label={trendLabel} size="sm" />
                ) : null}
                {description && trendValue === undefined ? (
                  <p className="text-xs text-zinc-300">{description}</p>
                ) : null}
              </div>
              {description && trendValue !== undefined ? (
                <p className="mt-0.5 text-xs text-zinc-300">{description}</p>
              ) : null}
            </div>
            {sparklineData && sparklineData.length >= 2 ? (
              <div
                className="shrink-0"
                style={{ filter: 'drop-shadow(0 0 4px rgba(34,197,94,0.2))' }}
              >
                <Sparkline data={sparklineData} width={80} height={32} gradientFill showLastDot />
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActionCard({
  href,
  icon: Icon,
  title,
  description,
  accentColor,
}: {
  href: Route;
  icon: LucideIcon;
  title: string;
  description: string;
  accentColor: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="glass glass-interactive glass-highlight group h-full border border-[var(--brand-gold)]/10 transition-all duration-200">
        <CardContent className="relative z-[2] flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-gold)]/[0.08] ring-1 ring-[var(--brand-gold)]/10">
            <Icon
              className="h-5 w-5 transition-transform duration-200 group-hover:scale-110"
              style={{ color: 'var(--brand-gold)' }}
              aria-hidden="true"
            />
          </div>
          <div>
            <p className="font-medium text-zinc-100">{title}</p>
            <p className="text-xs text-zinc-300">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function QuickActions({ isProvider }: { isProvider: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <QuickActionCard
        href="/jobs/new"
        icon={Plus}
        title="Post a Job"
        description="Get competitive bids from providers"
        accentColor="bg-primary/10"
      />

      {isProvider ? (
        <QuickActionCard
          href="/jobs"
          icon={Search}
          title="Browse Jobs"
          description="Find new jobs to bid on"
          accentColor="bg-primary/10"
        />
      ) : null}

      <QuickActionCard
        href="/contracts"
        icon={FileText}
        title="My Contracts"
        description="Manage active contracts"
        accentColor="bg-primary/10"
      />
    </div>
  );
}

function ChecklistItem({
  completed,
  label,
  href,
}: {
  completed: boolean;
  label: string;
  href?: Route;
}) {
  const content = (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg p-3 transition-colors',
        completed ? '' : href ? 'hover:bg-white/[0.04]' : '',
      )}
    >
      {completed ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
      ) : (
        <Circle className="h-5 w-5 shrink-0 text-zinc-600" aria-hidden="true" />
      )}
      <span className={cn('text-sm font-medium', completed ? 'text-zinc-400 line-through' : 'text-zinc-100')}>
        {label}
      </span>
    </div>
  );
  if (href && !completed) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

function CustomerOnboardingChecklist({ emailVerified }: { emailVerified: boolean }) {
  const { data: jobsData } = useCustomerJobs({ page: 1, page_size: 1 });
  const hasJobs = (jobsData?.pagination.totalCount ?? 0) > 0;

  if (hasJobs && emailVerified) return null;

  const doneCount = [true, emailVerified, hasJobs].filter(Boolean).length;
  const total = 3;

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="gold-text text-base">Get started</CardTitle>
          <span className="text-xs text-zinc-400">{String(doneCount)}/{String(total)} complete</span>
        </div>
        <p className="text-xs text-zinc-400">Complete these steps to get the most out of NoMarkup.</p>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="divide-y divide-white/[0.04]">
          <ChecklistItem completed label="Create your account" />
          <ChecklistItem
            completed={emailVerified}
            label="Verify your email"
            href={'/settings/security' as Route}
          />
          <ChecklistItem
            completed={hasJobs}
            label="Post your first job"
            href={'/jobs/new' as Route}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerDashboard() {
  const { data: jobsData, isLoading: jobsLoading } = useCustomerJobs({
    status: 'active',
    page: 1,
    page_size: 5,
  });
  const { data: contractsData, isLoading: contractsLoading } = useContracts({
    status: 'pending_acceptance',
    page: 1,
    page_size: 5,
  });
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments({
    status: 'completed',
    page: 1,
    per_page: 100,
  });
  const { data: spendingData } = useCustomerSpending(undefined, undefined, 'week');

  const activeJobCount = jobsData?.pagination.totalCount ?? 0;
  const bidsReceived = jobsData?.jobs.reduce((sum, j) => sum + j.bid_count, 0) ?? 0;
  const pendingContracts = contractsData?.pagination.totalCount ?? 0;
  const totalSpent = paymentsData?.payments.reduce((sum, p) => sum + p.amount_cents, 0) ?? 0;

  // Derive sparkline data from weekly spending data points
  const spendSparkline = spendingData?.data_points.map((dp) => dp.amount_cents);
  const jobCountSparkline = spendingData?.data_points.map((dp) => dp.job_count);

  const isLoading = jobsLoading || contractsLoading || paymentsLoading;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Jobs"
          value={String(activeJobCount)}
          numericValue={activeJobCount}
          description="Currently accepting bids"
          icon={Briefcase}
          loading={isLoading}
          sparklineData={jobCountSparkline}
        />
        <StatCard
          title="Bids Received"
          value={String(bidsReceived)}
          numericValue={bidsReceived}
          description="Across active jobs"
          icon={Gavel}
          loading={isLoading}
        />
        <StatCard
          title="Pending Actions"
          value={String(pendingContracts)}
          numericValue={pendingContracts}
          description="Contracts awaiting acceptance"
          icon={FileText}
          loading={isLoading}
        />
        <StatCard
          title="Total Spend"
          value={formatCents(totalSpent)}
          numericValue={totalSpent}
          isCurrency
          description="Completed payments"
          icon={DollarSign}
          loading={isLoading}
          sparklineData={spendSparkline}
        />
      </div>

      {ENABLE_LIVE_AUCTION ? <SavingsTracker /> : null}

      {/* Section divider — glass */}
      <div className="glass-divider" role="separator" />

      {/* Recent jobs */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader className="glass-header relative z-[2] flex flex-row items-center justify-between rounded-t-[1.25rem]">
          <CardTitle className="gold-text text-base font-semibold tracking-tight">
            Recent Jobs
          </CardTitle>
          <Link href="/jobs/mine">
            <Button variant="ghost" size="sm" className="min-h-[44px]">
              View all
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={`skel-job-${String(i)}`} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : !jobsData?.jobs.length ? (
            <p className="py-4 text-center text-sm text-zinc-300">
              No active jobs. Post your first job to get started.
            </p>
          ) : (
            <div className="relative z-[2]">
              {jobsData.jobs.slice(0, 5).map((job, index) => (
                <div key={job.id}>
                  {index > 0 ? <div className="glass-divider" role="separator" /> : null}
                  <Link
                    href={`/jobs/${job.id}`}
                    className="flex items-center justify-between rounded-md p-3 transition-all duration-150 hover:bg-white/[0.04] hover:pl-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{job.title}</p>
                      <p className="text-xs text-zinc-300">{job.category_name}</p>
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      <Badge variant="secondary">
                        {String(job.bid_count)} bid{job.bid_count !== 1 ? 's' : ''}
                      </Badge>
                      <Badge variant="outline" className="capitalize">
                        {job.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderDashboardSection() {
  const { data: bidsData, isLoading: bidsLoading } = useMyBids('active');
  const { data: allBidsData, isLoading: allBidsLoading } = useMyBids(undefined, undefined);
  const { data: contractsData, isLoading: contractsLoading } = useContracts({
    status: 'active',
    page: 1,
    page_size: 100,
  });
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments({
    status: 'completed',
    page: 1,
    per_page: 100,
  });
  const { data: earningsData } = useProviderEarnings(undefined, undefined, 'week');

  const activeBidCount = bidsData?.pagination.totalCount ?? 0;
  const activeContracts = contractsData?.pagination.totalCount ?? 0;
  const totalEarnings =
    paymentsData?.payments.reduce((sum, p) => sum + p.provider_payout_cents, 0) ?? 0;
  const winRate =
    allBidsData && allBidsData.bids.length > 0
      ? Math.round(
          (allBidsData.bids.filter((b) => b.status === 'awarded').length /
            allBidsData.bids.length) *
            100,
        )
      : 0;

  // Derive sparkline data from weekly earnings data points
  const earningsSparkline = earningsData?.data_points.map((dp) => dp.earnings_cents);
  const earningsJobSparkline = earningsData?.data_points.map((dp) => dp.job_count);

  const isLoading = bidsLoading || allBidsLoading || contractsLoading || paymentsLoading;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Bids"
          value={String(activeBidCount)}
          numericValue={activeBidCount}
          description="Awaiting decision"
          icon={Gavel}
          loading={isLoading}
        />
        <StatCard
          title="Active Contracts"
          value={String(activeContracts)}
          numericValue={activeContracts}
          description="Jobs in progress"
          icon={Briefcase}
          loading={isLoading}
          sparklineData={earningsJobSparkline}
        />
        <StatCard
          title="Total Earnings"
          value={formatCents(totalEarnings)}
          numericValue={totalEarnings}
          isCurrency
          description="Net provider payouts"
          icon={DollarSign}
          loading={isLoading}
          sparklineData={earningsSparkline}
        />
        <StatCard
          title="Win Rate"
          value={winRate > 0 ? `${String(winRate)}%` : '--'}
          numericValue={winRate}
          description="Based on bid outcomes"
          icon={TrendingUp}
          loading={isLoading}
        />
      </div>

      {/* Section divider — glass */}
      <div className="glass-divider" role="separator" />

      {/* Recent bids */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader className="glass-header relative z-[2] flex flex-row items-center justify-between rounded-t-[1.25rem]">
          <CardTitle className="gold-text text-base font-semibold tracking-tight">
            Active Bids
          </CardTitle>
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
                <Skeleton key={`skel-bid-${String(i)}`} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : !bidsData?.bids.length ? (
            <p className="py-4 text-center text-sm text-zinc-300">
              No active bids. Browse jobs to start bidding.
            </p>
          ) : (
            <div className="relative z-[2]">
              {bidsData.bids.slice(0, 5).map((bid, index) => (
                <div key={bid.id}>
                  {index > 0 ? <div className="glass-divider" role="separator" /> : null}
                  <Link
                    href={`/jobs/${bid.job_id}`}
                    className="flex items-center justify-between rounded-md p-3 transition-all duration-150 hover:bg-white/[0.04] hover:pl-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Bid: {formatCents(bid.amount_cents)}</p>
                      <p className="text-xs text-zinc-300">
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const { data: profile } = useProfile();

  const roles = user?.roles ?? [];
  const isCustomer = roles.includes(USER_ROLE.CUSTOMER);
  const isProvider = roles.includes(USER_ROLE.PROVIDER);

  if (isHydrating) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ContentLoader preset="stat-card" count={4} className="contents" />
        </div>
      </div>
    );
  }

  const greeting = getTimeOfDayGreeting();
  const firstName = user?.displayName?.split(' ')[0];

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            {greeting}
            {firstName ? `, ${firstName}` : ''}{' '}
            <span
              className="inline-block origin-[70%_70%] animate-[illustration-swing_2s_ease-in-out_2]"
              role="img"
              aria-label="waving hand"
            >
              {'\u{1F44B}'}
            </span>
          </h1>
          <p className="mt-1 text-zinc-300">Here is what is happening across your account today.</p>
        </div>

        <QuickActions isProvider={isProvider} />

        {isCustomer && !isProvider ? (
          <CustomerOnboardingChecklist emailVerified={profile?.emailVerified ?? true} />
        ) : null}

        {isCustomer ? (
          <div>
            {isProvider ? (
              <>
                <div className="glass-divider" role="separator" />
                <h2 className="gold-text mt-6 mb-4 text-lg font-bold tracking-tight">
                  Customer Overview
                </h2>
              </>
            ) : null}
            <CustomerDashboard />
          </div>
        ) : null}

        {isProvider ? (
          <div>
            {isCustomer ? (
              <>
                <div className="glass-divider" role="separator" />
                <h2 className="gold-text mt-6 mb-4 text-lg font-bold tracking-tight">
                  Provider Overview
                </h2>
              </>
            ) : null}
            <ProviderDashboardSection />
          </div>
        ) : null}

        {!isCustomer && !isProvider ? <CustomerDashboard /> : null}
      </div>
    </PageTransition>
  );
}
