'use client';

import { CreditCard } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { PaymentHistory } from '@/components/payments/PaymentHistory';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Button } from '@/components/ui/button';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePayments } from '@/hooks/usePayments';

type PaymentTab = 'all' | 'pending' | 'escrow' | 'completed' | 'failed' | 'refunded';

function tabToStatusFilter(tab: PaymentTab): string | undefined {
  switch (tab) {
    case 'pending':
      return 'pending';
    case 'escrow':
      return 'escrow';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    default:
      return undefined;
  }
}

function PaymentTabContent({ tab }: { tab: PaymentTab }) {
  const [page, setPage] = useState(1);
  const statusFilter = tabToStatusFilter(tab);
  const { data, isLoading, isError, refetch } = usePayments({
    status: statusFilter,
    page,
    per_page: 20,
  });

  if (isLoading) {
    return <ContentLoader preset="contract-card" count={3} className="space-y-3" />;
  }

  if (isError) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="error" size="md" />}
        title="Failed to load payments"
        description="Something went wrong while fetching your payment data. Please try again."
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

  const payments = data?.payments ?? [];
  const pagination = data?.pagination;

  if (payments.length === 0) {
    const emptyMessages: Record<PaymentTab, string> = {
      all: 'You have no payments yet.',
      pending: 'No pending payments.',
      escrow: 'No payments currently in escrow.',
      completed: 'No completed payments.',
      failed: 'No failed payments.',
      refunded: 'No refunded payments.',
    };

    return (
      <div className="glass glass-highlight flex flex-col items-center justify-center rounded-lg border border-[var(--brand-gold)]/10 py-12">
        <CreditCard className="text-white/50 h-12 w-12" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">No payments</p>
        <p className="text-zinc-300 mt-1 text-sm">{emptyMessages[tab]}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button asChild className="min-h-[44px]">
            <Link href="/jobs/new">Post a Job</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link href="/settings/payment-methods">Payment methods</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PaymentHistory payments={payments} />

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
            }}
          >
            Previous
          </Button>
          <span className="text-zinc-300 text-sm">
            Page {String(page)} of {String(pagination.totalPages)}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={!pagination.hasNext}
            onClick={() => {
              setPage((p) => p + 1);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <PageTransition>
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Payments</h1>
          <p className="mt-1 text-zinc-300">
            Track payments, fee breakdowns, and escrow. Manage saved cards under payment methods.
          </p>
        </div>
        <Button asChild variant="outline" className="min-h-[44px] shrink-0">
          <Link href="/settings/payment-methods">Manage payment methods</Link>
        </Button>
      </div>

      <Tabs defaultValue="all">
        <TabsList className="glass glass-highlight flex w-full overflow-x-auto sm:w-auto">
          <TabsTrigger value="all" className="min-h-[44px]">
            All
          </TabsTrigger>
          <TabsTrigger value="pending" className="min-h-[44px]">
            Pending
          </TabsTrigger>
          <TabsTrigger value="escrow" className="min-h-[44px]">
            Escrow
          </TabsTrigger>
          <TabsTrigger value="completed" className="min-h-[44px]">
            Completed
          </TabsTrigger>
          <TabsTrigger value="failed" className="min-h-[44px]">
            Failed
          </TabsTrigger>
          <TabsTrigger value="refunded" className="min-h-[44px]">
            Refunded
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <PaymentTabContent tab="all" />
        </TabsContent>
        <TabsContent value="pending">
          <PaymentTabContent tab="pending" />
        </TabsContent>
        <TabsContent value="escrow">
          <PaymentTabContent tab="escrow" />
        </TabsContent>
        <TabsContent value="completed">
          <PaymentTabContent tab="completed" />
        </TabsContent>
        <TabsContent value="failed">
          <PaymentTabContent tab="failed" />
        </TabsContent>
        <TabsContent value="refunded">
          <PaymentTabContent tab="refunded" />
        </TabsContent>
      </Tabs>
    </div>
    </PageTransition>
  );
}
