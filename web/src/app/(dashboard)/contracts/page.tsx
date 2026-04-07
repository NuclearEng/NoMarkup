'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ContractCard } from '@/components/contracts/ContractCard';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Button } from '@/components/ui/button';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useContracts } from '@/hooks/useContracts';

type ContractTab = 'all' | 'pending' | 'active' | 'completed' | 'cancelled';

function tabToStatusFilter(tab: ContractTab): string | undefined {
  switch (tab) {
    case 'pending':
      return 'pending_acceptance';
    case 'active':
      return 'active';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}

function ContractTabContent({ tab }: { tab: ContractTab }) {
  const [page, setPage] = useState(1);
  const statusFilter = tabToStatusFilter(tab);
  const { data, isLoading, isError, refetch } = useContracts({
    status: statusFilter,
    page,
    page_size: 20,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <ContentLoader preset="contract-card" count={4} className="contents" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="error" size="sm" />}
        title="Failed to load contracts"
        description="Something went wrong. Check your connection and try again."
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

  const contracts = data?.contracts ?? [];
  const pagination = data?.pagination;

  if (contracts.length === 0) {
    const emptyMessages: Record<ContractTab, string> = {
      all: 'You have no contracts yet.',
      pending: 'No contracts pending acceptance.',
      active: 'No active contracts.',
      completed: 'No completed contracts.',
      cancelled: 'No cancelled contracts.',
    };

    return (
      <EmptyState
        icon={<AnimatedIllustration type="no-contracts" size="sm" />}
        title="No contracts"
        description={emptyMessages[tab]}
        action={
          <Button asChild className="min-h-[44px]">
            <Link href="/jobs">Browse Jobs</Link>
          </Button>
        }
        className="glass"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {contracts.map((contract) => (
          <ContractCard key={contract.id} contract={contract} />
        ))}
      </div>

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
          <span className="text-sm text-zinc-300">
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

export default function ContractsPage() {
  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Contracts</h1>
          <p className="mt-1 text-zinc-300">
            Manage your contracts, track milestones, and handle payments.
          </p>
        </div>

        <Tabs defaultValue="all">
          <TabsList className="glass glass-highlight">
            <TabsTrigger value="all" className="min-h-[44px]">
              All
            </TabsTrigger>
            <TabsTrigger value="pending" className="min-h-[44px]">
              Pending
            </TabsTrigger>
            <TabsTrigger value="active" className="min-h-[44px]">
              Active
            </TabsTrigger>
            <TabsTrigger value="completed" className="min-h-[44px]">
              Completed
            </TabsTrigger>
            <TabsTrigger value="cancelled" className="min-h-[44px]">
              Cancelled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <ContractTabContent tab="all" />
          </TabsContent>
          <TabsContent value="pending">
            <ContractTabContent tab="pending" />
          </TabsContent>
          <TabsContent value="active">
            <ContractTabContent tab="active" />
          </TabsContent>
          <TabsContent value="completed">
            <ContractTabContent tab="completed" />
          </TabsContent>
          <TabsContent value="cancelled">
            <ContractTabContent tab="cancelled" />
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}
