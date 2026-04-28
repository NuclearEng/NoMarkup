'use client';

import { Package, Plus } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { ListingCard } from '@/components/marketplace/ListingCard';
import { Button } from '@/components/ui/button';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMyListings, useDeleteListingDraft, useCancelListing } from '@/hooks/useListings';
import { LISTING_STATUS } from '@/types';

type SellTab = 'active' | 'sold' | 'drafts' | 'cancelled';

function tabToStatus(tab: SellTab): string {
  switch (tab) {
    case 'active':
      return LISTING_STATUS.ACTIVE;
    case 'sold':
      return LISTING_STATUS.SOLD;
    case 'drafts':
      return LISTING_STATUS.DRAFT;
    case 'cancelled':
      return LISTING_STATUS.CANCELLED;
  }
}

function MyListingsContent({ tab }: { tab: SellTab }) {
  const [page, setPage] = useState(1);
  const status = tabToStatus(tab);
  const { data, isLoading, isError, refetch } = useMyListings(status, page);
  const deleteDraft = useDeleteListingDraft();
  const cancelListing = useCancelListing();

  if (isLoading) {
    return <ContentLoader preset="bid-card" count={3} className="space-y-4" />;
  }

  if (isError) {
    return (
      <EmptyState
        icon={<Package className="h-8 w-8" aria-hidden="true" />}
        title="Failed to load listings"
        description="Something went wrong. Try again."
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
      />
    );
  }

  const listings = data?.listings ?? [];
  const pagination = data?.pagination;

  if (listings.length === 0) {
    const messages: Record<SellTab, string> = {
      active: 'You have no active listings yet.',
      sold: 'No completed sales yet.',
      drafts: 'No drafts saved.',
      cancelled: 'No cancelled listings.',
    };
    return (
      <EmptyState
        icon={<Package className="h-8 w-8" aria-hidden="true" />}
        title="Nothing here"
        description={messages[tab]}
        action={
          <Button asChild className="min-h-[44px]">
            <Link href={'/sell/new' as Route}>Start a listing</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {listings.map((listing) => (
          <div key={listing.id} className="space-y-2">
            <ListingCard listing={listing} />
            <div className="flex flex-wrap gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="min-h-[40px] flex-1 border-white/10"
              >
                <Link href={`/marketplace/${listing.id}` as Route}>View</Link>
              </Button>
              {tab === 'drafts' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[40px] flex-1 border-red-500/30 text-red-300 hover:bg-red-500/10"
                  disabled={deleteDraft.isPending}
                  onClick={() => {
                    deleteDraft.mutate(listing.id);
                  }}
                >
                  Delete
                </Button>
              ) : null}
              {tab === 'active' && listing.bid_count === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[40px] flex-1 border-red-500/30 text-red-300 hover:bg-red-500/10"
                  disabled={cancelListing.isPending}
                  onClick={() => {
                    cancelListing.mutate(listing.id);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
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

export default function SellMinePage() {
  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="gold-text text-2xl font-bold tracking-tight">My listings</h1>
            <p className="mt-1 text-zinc-300">
              Track your goods listings — bids, sales, and drafts.
            </p>
          </div>
          <Button asChild className="min-h-[44px] bg-[var(--brand-gold)] text-black hover:bg-[var(--brand-gold)]/90">
            <Link href={'/sell/new' as Route}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New listing
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="active">
          <TabsList className="glass glass-highlight">
            <TabsTrigger value="active" className="min-h-[44px]">
              Active
            </TabsTrigger>
            <TabsTrigger value="sold" className="min-h-[44px]">
              Sold
            </TabsTrigger>
            <TabsTrigger value="drafts" className="min-h-[44px]">
              Drafts
            </TabsTrigger>
            <TabsTrigger value="cancelled" className="min-h-[44px]">
              Cancelled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="active">
            <MyListingsContent tab="active" />
          </TabsContent>
          <TabsContent value="sold">
            <MyListingsContent tab="sold" />
          </TabsContent>
          <TabsContent value="drafts">
            <MyListingsContent tab="drafts" />
          </TabsContent>
          <TabsContent value="cancelled">
            <MyListingsContent tab="cancelled" />
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}
