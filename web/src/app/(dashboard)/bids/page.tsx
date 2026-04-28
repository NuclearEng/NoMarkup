'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { ProviderBidCard } from '@/components/bids/ProviderBidCard';
import { MyListingBidCard } from '@/components/marketplace/MyListingBidCard';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Button } from '@/components/ui/button';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMyBids } from '@/hooks/useBids';
import { useMyListingBids } from '@/hooks/useListings';

type ServicesTab = 'all' | 'active' | 'awarded' | 'lost';

function tabToStatusFilter(tab: ServicesTab): string | undefined {
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

function ServicesBidContent({ tab }: { tab: ServicesTab }) {
  const [page, setPage] = useState(1);
  const statusFilter = tabToStatusFilter(tab);
  const { data, isLoading, isError, refetch } = useMyBids(statusFilter, page);

  if (isLoading) {
    return <ContentLoader preset="bid-card" count={3} className="space-y-4" />;
  }

  if (isError) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="error" size="sm" />}
        title="Failed to load bids"
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

  const bids = data?.bids ?? [];
  const pagination = data?.pagination;

  if (bids.length === 0) {
    const emptyMessages: Record<ServicesTab, string> = {
      all: 'You have not placed any bids yet.',
      active: 'You have no active bids.',
      awarded: 'You have not won any bids yet.',
      lost: 'No lost bids.',
    };

    return (
      <EmptyState
        icon={<AnimatedIllustration type="no-bids" size="sm" />}
        title="No bids"
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
        {bids.map((bid) => (
          <ProviderBidCard key={bid.id} bid={bid} />
        ))}
      </div>

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

function GoodsBidContent() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useMyListingBids(page);

  if (isLoading) {
    return <ContentLoader preset="bid-card" count={3} className="space-y-4" />;
  }

  if (isError) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="error" size="sm" />}
        title="Failed to load bids"
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

  const entries = data?.bids ?? [];
  const pagination = data?.pagination;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="no-bids" size="sm" />}
        title="No goods bids"
        description="You haven't placed any bids on goods listings yet."
        action={
          <Button asChild className="min-h-[44px]">
            <Link href={'/marketplace' as Route}>Browse marketplace</Link>
          </Button>
        }
        className="glass"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {entries.map((entry) => (
          <MyListingBidCard key={entry.bid.id} entry={entry} />
        ))}
      </div>

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

export default function MyBidsPage() {
  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">My Bids</h1>
          <p className="mt-1 text-zinc-300">Track your bids on services and goods.</p>
        </div>

        <Tabs defaultValue="services">
          <TabsList className="glass glass-highlight">
            <TabsTrigger value="services" className="min-h-[44px]">
              Services
            </TabsTrigger>
            <TabsTrigger value="goods" className="min-h-[44px]">
              Goods
            </TabsTrigger>
          </TabsList>

          <TabsContent value="services">
            <Tabs defaultValue="all" className="mt-2">
              <TabsList className="glass glass-highlight">
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
                <ServicesBidContent tab="all" />
              </TabsContent>
              <TabsContent value="active">
                <ServicesBidContent tab="active" />
              </TabsContent>
              <TabsContent value="awarded">
                <ServicesBidContent tab="awarded" />
              </TabsContent>
              <TabsContent value="lost">
                <ServicesBidContent tab="lost" />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="goods">
            <GoodsBidContent />
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}
