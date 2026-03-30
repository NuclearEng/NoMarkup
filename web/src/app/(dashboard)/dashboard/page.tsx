'use client';

import {
  Briefcase,
  DollarSign,
  FileText,
  Gavel,
  Plus,
  Search,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

import { SavingsTracker } from '@/components/dashboard/SavingsTracker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContentLoader } from '@/components/ui/content-loader';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { useMyBids } from '@/hooks/useBids';
import { useContracts } from '@/hooks/useContracts';
import { useCustomerJobs } from '@/hooks/useJobs';
import { usePayments } from '@/hooks/usePayments';
import { formatCents } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QuickActions({ isProvider }: { isProvider: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Link href="/jobs/new" className="block">
        <Card className="h-full transition-shadow hover:shadow-md">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Plus className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <p className="font-medium">Post a Job</p>
              <p className="text-xs text-muted-foreground">
                Get competitive bids from providers
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>

      {isProvider ? (
        <Link href="/jobs" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Search className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">Browse Jobs</p>
                <p className="text-xs text-muted-foreground">
                  Find new jobs to bid on
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      ) : null}

      <Link href="/contracts" className="block">
        <Card className="h-full transition-shadow hover:shadow-md">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <p className="font-medium">My Contracts</p>
              <p className="text-xs text-muted-foreground">
                Manage active contracts
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

function CustomerDashboard() {
  const { data: jobsData, isLoading: jobsLoading } = useCustomerJobs({ status: 'active', page: 1, page_size: 5 });
  const { data: contractsData, isLoading: contractsLoading } = useContracts({ status: 'pending_acceptance', page: 1, page_size: 5 });
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments({ status: 'completed', page: 1, per_page: 100 });

  const activeJobCount = jobsData?.pagination.totalCount ?? 0;
  const pendingContracts = contractsData?.pagination.totalCount ?? 0;
  const totalSpent = paymentsData?.payments.reduce((sum, p) => sum + p.amount_cents, 0) ?? 0;

  const isLoading = jobsLoading || contractsLoading || paymentsLoading;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Jobs"
          value={String(activeJobCount)}
          description="Currently accepting bids"
          icon={Briefcase}
          loading={isLoading}
        />
        <StatCard
          title="Bids Received"
          value={String(jobsData?.jobs.reduce((sum, j) => sum + j.bid_count, 0) ?? 0)}
          description="Across active jobs"
          icon={Gavel}
          loading={isLoading}
        />
        <StatCard
          title="Pending Actions"
          value={String(pendingContracts)}
          description="Contracts awaiting acceptance"
          icon={FileText}
          loading={isLoading}
        />
        <StatCard
          title="Total Spend"
          value={formatCents(totalSpent)}
          description="Completed payments"
          icon={DollarSign}
          loading={isLoading}
        />
      </div>

      {ENABLE_LIVE_AUCTION ? <SavingsTracker /> : null}

      {/* Recent jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Jobs</CardTitle>
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
            <p className="py-4 text-center text-sm text-muted-foreground">
              No active jobs. Post your first job to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {jobsData.jobs.slice(0, 5).map((job) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{job.title}</p>
                    <p className="text-xs text-muted-foreground">{job.category_name}</p>
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
  const { data: contractsData, isLoading: contractsLoading } = useContracts({ status: 'active', page: 1, page_size: 100 });
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments({ status: 'completed', page: 1, per_page: 100 });

  const activeBidCount = bidsData?.pagination.totalCount ?? 0;
  const activeContracts = contractsData?.pagination.totalCount ?? 0;
  const totalEarnings = paymentsData?.payments.reduce((sum, p) => sum + p.provider_payout_cents, 0) ?? 0;

  const isLoading = bidsLoading || allBidsLoading || contractsLoading || paymentsLoading;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Bids"
          value={String(activeBidCount)}
          description="Awaiting decision"
          icon={Gavel}
          loading={isLoading}
        />
        <StatCard
          title="Active Contracts"
          value={String(activeContracts)}
          description="Jobs in progress"
          icon={Briefcase}
          loading={isLoading}
        />
        <StatCard
          title="Total Earnings"
          value={formatCents(totalEarnings)}
          description="Net provider payouts"
          icon={DollarSign}
          loading={isLoading}
        />
        <StatCard
          title="Win Rate"
          value={
            allBidsData && allBidsData.bids.length > 0
              ? `${String(Math.round((allBidsData.bids.filter((b) => b.status === 'awarded').length / allBidsData.bids.length) * 100))}%`
              : '--'
          }
          description="Based on bid outcomes"
          icon={TrendingUp}
          loading={isLoading}
        />
      </div>

      {/* Recent bids */}
      <Card>
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
                <Skeleton key={`skel-bid-${String(i)}`} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : !bidsData?.bids.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No active bids. Browse jobs to start bidding.
            </p>
          ) : (
            <div className="space-y-2">
              {bidsData.bids.slice(0, 5).map((bid) => (
                <Link
                  key={bid.id}
                  href={`/jobs/${bid.job_id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      Bid: {formatCents(bid.amount_cents)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Placed {new Date(bid.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
  );
}

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);

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

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back{user?.displayName ? `, ${user.displayName}` : ''}.
          </p>
        </div>

        <QuickActions isProvider={isProvider} />

        {isCustomer ? (
          <div>
            {isProvider ? (
              <h2 className="mb-4 text-lg font-semibold">Customer Overview</h2>
            ) : null}
            <CustomerDashboard />
          </div>
        ) : null}

        {isProvider ? (
          <div>
            {isCustomer ? (
              <h2 className="mb-4 text-lg font-semibold">Provider Overview</h2>
            ) : null}
            <ProviderDashboardSection />
          </div>
        ) : null}

        {!isCustomer && !isProvider ? (
          <CustomerDashboard />
        ) : null}
      </div>
    </PageTransition>
  );
}
