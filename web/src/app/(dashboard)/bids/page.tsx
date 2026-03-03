'use client';

import { Inbox } from 'lucide-react';
import { useState } from 'react';

import { ProviderBidCard } from '@/components/bids/ProviderBidCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMyBids } from '@/hooks/useBids';

type BidTab = 'all' | 'active' | 'awarded' | 'lost';

function tabToStatusFilter(tab: BidTab): string | undefined {
  switch (tab) {
    case 'active':
      return 'active';
    case 'awarded':
      return 'awarded';
    case 'lost':
      return 'not_selected';
    default:
      return undefined;
  }
}

function BidTabContent({ tab }: { tab: BidTab }) {
  const [page, setPage] = useState(1);
  const statusFilter = tabToStatusFilter(tab);
  const { data, isLoading, isError } = useMyBids(statusFilter, page);

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
        Failed to load bids. Please try refreshing the page.
      </div>
    );
  }

  const bids = data?.bids ?? [];
  const pagination = data?.pagination;

  if (bids.length === 0) {
    const emptyMessages: Record<BidTab, string> = {
      all: 'You have not placed any bids yet.',
      active: 'You have no active bids.',
      awarded: 'You have not won any bids yet.',
      lost: 'No lost bids.',
    };

    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/50 py-12">
        <Inbox className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">No bids</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyMessages[tab]}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {bids.map((bid) => (
          <ProviderBidCard key={bid.id} bid={bid} />
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

export default function MyBidsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Bids</h1>
        <p className="mt-1 text-muted-foreground">
          Track and manage your bids across all jobs.
        </p>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all" className="min-h-[44px]">
            All
          </TabsTrigger>
          <TabsTrigger value="active" className="min-h-[44px]">
            Active
          </TabsTrigger>
          <TabsTrigger value="awarded" className="min-h-[44px]">
            Won
          </TabsTrigger>
          <TabsTrigger value="lost" className="min-h-[44px]">
            Lost
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <BidTabContent tab="all" />
        </TabsContent>
        <TabsContent value="active">
          <BidTabContent tab="active" />
        </TabsContent>
        <TabsContent value="awarded">
          <BidTabContent tab="awarded" />
        </TabsContent>
        <TabsContent value="lost">
          <BidTabContent tab="lost" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
