'use client';

import { CreditCard } from 'lucide-react';
import { useState } from 'react';

import { PaymentHistory } from '@/components/payments/PaymentHistory';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  const { data, isLoading, isError } = usePayments({
    status: statusFilter,
    page,
    per_page: 20,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded bg-muted" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load payments. Please try refreshing the page.
      </div>
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
      <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/50 py-12">
        <CreditCard className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">No payments</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyMessages[tab]}</p>
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
            onClick={() => { setPage((p) => p - 1); }}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {String(page)} of {String(pagination.totalPages)}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={!pagination.hasNext}
            onClick={() => { setPage((p) => p + 1); }}
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <p className="mt-1 text-muted-foreground">
          Track your payments, view fee breakdowns, and manage payment methods.
        </p>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
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
  );
}
