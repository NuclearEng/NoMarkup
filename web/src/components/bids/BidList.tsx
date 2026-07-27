'use client';

import { Inbox } from 'lucide-react';
import { useMemo, useState } from 'react';

import { BidCard } from '@/components/bids/BidCard';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useBidsForJob } from '@/hooks/useBids';
import type { BidWithProvider } from '@/types';

interface BidListProps {
  jobId: string;
  canAward: boolean;
  startingPriceCents?: number;
  marketMedianCents?: number;
}

type SortOption =
  | 'price_asc'
  | 'price_desc'
  | 'win_chance'
  | 'rating'
  | 'trust'
  | 'jobs_completed'
  | 'newest';

/**
 * Price ascending is the canonical tiebreaker: in a reverse auction the lowest
 * price is the most relevant signal, so equal/absent secondary fields fall back
 * to it. Without this, sorting by trust/rating when those fields are null for
 * every bid (a common case — they come from separate services) would leave the
 * list in source order and look like the dropdown "did nothing".
 */
function byPriceAsc(a: BidWithProvider, b: BidWithProvider): number {
  return a.bid.amount_cents - b.bid.amount_cents;
}

function sortBids(bids: BidWithProvider[], sortBy: SortOption): BidWithProvider[] {
  const sorted = [...bids];
  switch (sortBy) {
    case 'price_asc':
    case 'win_chance':
      // Win chance is derived purely from price rank (rank 1 = lowest = "High
      // chance"), so it is equivalent to price ascending.
      return sorted.sort(byPriceAsc);
    case 'price_desc':
      return sorted.sort((a, b) => b.bid.amount_cents - a.bid.amount_cents);
    case 'rating':
      return sorted.sort((a, b) => {
        const aRating = a.review_summary?.average_rating ?? 0;
        const bRating = b.review_summary?.average_rating ?? 0;
        return bRating - aRating || byPriceAsc(a, b);
      });
    case 'trust':
      return sorted.sort((a, b) => {
        const aScore = a.trust_score?.overall_score ?? 0;
        const bScore = b.trust_score?.overall_score ?? 0;
        return bScore - aScore || byPriceAsc(a, b);
      });
    case 'jobs_completed':
      return sorted.sort((a, b) => b.jobs_completed - a.jobs_completed || byPriceAsc(a, b));
    case 'newest':
      return sorted.sort(
        (a, b) =>
          new Date(b.bid.created_at).getTime() - new Date(a.bid.created_at).getTime() ||
          byPriceAsc(a, b),
      );
    default:
      return sorted;
  }
}

export function BidList({ jobId, canAward, startingPriceCents, marketMedianCents }: BidListProps) {
  const { data, isLoading, isError } = useBidsForJob(jobId);
  const [sortBy, setSortBy] = useState<SortOption>('price_asc');

  const bids = useMemo(() => data?.bids ?? [], [data]);
  const sortedBids = useMemo(() => sortBids(bids, sortBy), [bids, sortBy]);

  // Price-based ranks for competitive context (always by price, regardless of sort).
  const bidRankMap = useMemo(() => {
    const ranked = [...bids].sort(byPriceAsc);
    const map = new Map<string, number>();
    ranked.forEach((b, i) => {
      map.set(b.bid.id, i + 1);
    });
    return map;
  }, [bids]);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading bids">
        <Skeleton className="h-6 w-32" />
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
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

  if (bids.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/50 py-12">
        <Inbox className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">No bids yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Bids from providers will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          {String(bids.length)} bid{bids.length !== 1 ? 's' : ''}
        </p>
        <Select value={sortBy} onValueChange={(value) => { setSortBy(value as SortOption); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="price_asc">Price: Low to High</SelectItem>
            <SelectItem value="price_desc">Price: High to Low</SelectItem>
            <SelectItem value="win_chance">Best Win Chance</SelectItem>
            <SelectItem value="trust">Trust Score</SelectItem>
            <SelectItem value="rating">Highest Rating</SelectItem>
            <SelectItem value="jobs_completed">Most Jobs</SelectItem>
            <SelectItem value="newest">Newest First</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bid cards */}
      <div className="space-y-4">
        {sortedBids.map((bidWithProvider) => (
          <BidCard
            key={bidWithProvider.bid.id}
            bidWithProvider={bidWithProvider}
            jobId={jobId}
            canAward={canAward}
            rank={bidRankMap.get(bidWithProvider.bid.id)}
            totalBids={bids.length}
            startingPriceCents={startingPriceCents}
            marketMedianCents={marketMedianCents}
          />
        ))}
      </div>
    </div>
  );
}
