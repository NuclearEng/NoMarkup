'use client';

import { Activity, TrendingDown, Wifi, WifiOff } from 'lucide-react';

import { BidForm } from '@/components/bids/BidForm';
import { PriceDropChart } from '@/components/bids/PriceDropChart';
import { SnipeIndicator } from '@/components/bids/SnipeIndicator';
import { useAuctionStream } from '@/hooks/useAuctionStream';
import { useLiveAuctionState } from '@/hooks/useBids';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import type { JobDetail } from '@/types';

interface AuctionArenaProps {
  job: JobDetail;
  isProvider: boolean;
  isJobOwner: boolean;
}

export function AuctionArena({ job, isProvider, isJobOwner }: AuctionArenaProps) {
  const {
    events,
    connectionStatus,
    currentLowest,
    bidCount,
    auctionEndsAt,
    snipeExtensionCount,
    isConnected,
  } = useAuctionStream(job.id);

  const { data: auctionState } = useLiveAuctionState(job.id);

  if (!ENABLE_LIVE_AUCTION) return null;

  // Use WebSocket data if connected, fall back to REST, then job data
  const displayLowest = currentLowest || auctionState?.lowest_bid_cents || job.lowest_bid_cents || 0;
  const displayBidCount = bidCount || auctionState?.bid_count || job.bid_count || 0;
  const displayEndsAt = auctionEndsAt || auctionState?.auction_ends_at || job.auction_ends_at;
  const displaySnipeCount = snipeExtensionCount || auctionState?.snipe_extension_count || job.snipe_extension_count || 0;
  const displayEvents = events.length > 0 ? events : auctionState?.recent_events || [];

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Live Auction</h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isConnected ? (
            <>
              <Wifi className="h-4 w-4 text-green-500" aria-hidden="true" />
              <span>Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>{connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}</span>
            </>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {/* Current lowest bid */}
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Current Lowest</p>
          <p className="mt-1 text-xl font-bold text-green-600 sm:text-2xl">
            {displayLowest > 0 ? formatCurrency(displayLowest) : '\u2014'}
          </p>
        </div>

        {/* Bid count */}
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Total Bids</p>
          <div className="mt-1 flex items-baseline justify-center gap-1">
            <p className="text-xl font-bold sm:text-2xl">{String(displayBidCount)}</p>
            <TrendingDown className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
          </div>
        </div>

        {/* Anti-snipe indicator */}
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Extensions</p>
          <div className="mt-1">
            <SnipeIndicator count={displaySnipeCount} max={3} />
          </div>
        </div>
      </div>

      {/* Price drop chart */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Price History</h3>
        <PriceDropChart events={displayEvents} />
      </div>

      {/* Bid form for providers */}
      {isProvider && !isJobOwner && job.status === 'active' ? (
        <BidForm
          jobId={job.id}
          existingBid={null}
          startingBidCents={job.starting_bid_cents}
          offerAcceptedCents={job.offer_accepted_cents}
          marketRange={job.market_range}
          auctionEndsAt={displayEndsAt}
        />
      ) : null}
    </div>
  );
}
