'use client';

import { FileText } from 'lucide-react';
import { useState } from 'react';

import { ContractCard } from '@/components/contracts/ContractCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  const { data, isLoading, isError } = useContracts({
    status: statusFilter,
    page,
    per_page: 20,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-8 w-1/4 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
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
        Failed to load contracts. Please try refreshing the page.
      </div>
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
      <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/50 py-12">
        <FileText className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">No contracts</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyMessages[tab]}</p>
      </div>
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

export default function ContractsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your contracts, track milestones, and handle payments.
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
  );
}
