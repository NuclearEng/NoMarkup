'use client';

import { Inbox } from 'lucide-react';
import { useState } from 'react';

import { BidCard } from '@/components/bids/BidCard';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBidsForJob } from '@/hooks/useBids';
import type { BidWithProvider } from '@/types';

interface BidListProps {
  jobId: string;
  canAward: boolean;
}

type SortOption = 'price_asc' | 'rating' | 'trust' | 'jobs_completed';

function sortBids(bids: BidWithProvider[], sortBy: SortOption): BidWithProvider[] {
  const sorted = [...bids];
  switch (sortBy) {
    case 'price_asc':
      return sorted.sort((a, b) => a.bid.amount_cents - b.bid.amount_cents);
    case 'rating':
      return sorted.sort((a, b) => {
        const aRating = a.review_summary?.average_rating ?? 0;
        const bRating = b.review_summary?.average_rating ?? 0;
        return bRating - aRating;
      });
    case 'trust':
      return sorted.sort((a, b) => {
        const aScore = a.trust_score?.overall_score ?? 0;
        const bScore = b.trust_score?.overall_score ?? 0;
        return bScore - aScore;
      });
    case 'jobs_completed':
      return sorted.sort((a, b) => b.jobs_completed - a.jobs_completed);
    default:
      return sorted;
  }
}

export function BidList({ jobId, canAward }: BidListProps) {
  const { data, isLoading, isError } = useBidsForJob(jobId);
  const [sortBy, setSortBy] = useState<SortOption>('price_asc');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="h-10 animate-pulse rounded bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
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
  const sortedBids = sortBids(bids, sortBy);

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
            <SelectItem value="rating">Highest Rating</SelectItem>
            <SelectItem value="trust">Trust Score</SelectItem>
            <SelectItem value="jobs_completed">Most Jobs</SelectItem>
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
          />
        ))}
      </div>
    </div>
  );
}
