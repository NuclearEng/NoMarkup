'use client';

import { Calculator, FileText, Receipt } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useProviderAnalytics } from '@/hooks/useAnalytics';
import { useExpenses } from '@/hooks/useExpenses';
import { formatCents } from '@/lib/utils';

function StatCard({
  title,
  value,
  loading,
}: {
  title: string;
  value: string;
  loading: boolean;
}) {
  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardContent className="p-4">
        <p className="text-sm font-medium text-zinc-400">{title}</p>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-24" />
        ) : (
          <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

const BUSINESS_LINKS = [
  {
    title: 'Tax Center',
    description: 'View earnings, 1099 threshold, and quarterly estimates',
    href: '/provider/business/tax',
    icon: Receipt,
  },
  {
    title: 'Invoices',
    description: 'View and print invoices for completed contracts',
    href: '/provider/business/invoices',
    icon: FileText,
  },
  {
    title: 'Expense Tracking',
    description: 'Track business expenses for tax deductions',
    href: '/provider/business/expenses',
    icon: Calculator,
  },
] as const;

export default function ProviderBusinessPage() {
  const { data: analytics, isLoading: analyticsLoading } = useProviderAnalytics();
  const { data: expensesData, isLoading: expensesLoading } = useExpenses();

  const ytdRevenue = analytics?.total_earnings_cents ?? 0;
  const ytdExpenses = expensesData?.total_cents ?? 0;
  const netIncome = ytdRevenue - ytdExpenses;

  const isLoading = analyticsLoading || expensesLoading;

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Business Services</h1>
        <p className="mt-1 text-zinc-400">
          Manage your business finances, taxes, and invoices.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="YTD Revenue"
          value={formatCents(ytdRevenue)}
          loading={isLoading}
        />
        <StatCard
          title="YTD Expenses"
          value={formatCents(ytdExpenses)}
          loading={isLoading}
        />
        <StatCard
          title="Net Income"
          value={formatCents(netIncome)}
          loading={isLoading}
        />
      </div>

      {/* Business links */}
      <div className="grid gap-4 sm:grid-cols-3">
        {BUSINESS_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="glass glass-interactive h-full border border-[var(--brand-gold)]/10">
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <link.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base">{link.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-400">{link.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
    </PageTransition>
  );
}
