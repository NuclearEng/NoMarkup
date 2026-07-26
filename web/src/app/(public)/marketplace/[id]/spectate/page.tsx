'use client';

import { ArrowLeft, MapPin, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';

import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import { GradientMesh } from '@/components/landing/GradientMesh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Sparkline } from '@/components/ui/sparkline';
import { useListing, useListingBids } from '@/hooks/useListings';
import { useMarketplaceSpectator } from '@/hooks/useMarketplaceSpectator';
import { formatCents, formatRelativeTime } from '@/lib/utils';

export default function ListingSpectatePage() {
  const params = useParams<{ id: string }>();
  const listingId = params.id;

  const { data: listing, isLoading, isError, refetch, isFetching } = useListing(listingId);
  const { data: bidHistory } = useListingBids(listingId);

  // Live order flow over the marketplace spectator socket (FE-06).
  // Never claim LIVE unless the socket is actually connected.
  const { isConnected, connectionStatus, lastBid, watcherCount } =
    useMarketplaceSpectator(listingId);

  const liveBidCents = lastBid?.amount_cents;
  const displayBidCents =
    liveBidCents !== undefined && listing
      ? Math.max(listing.current_bid_cents, liveBidCents)
      : listing?.current_bid_cents;

  const sparklineSeries = useMemo(() => {
    if (!listing) return [];
    if (bidHistory && bidHistory.bids.length > 0) {
      const series = [
        listing.starting_price_cents,
        ...bidHistory.bids.map((b) => b.amount_cents).reverse(),
      ];
      if (liveBidCents !== undefined && liveBidCents !== series[series.length - 1]) {
        series.push(liveBidCents);
      }
      return series;
    }
    return [listing.starting_price_cents, displayBidCents ?? listing.current_bid_cents];
  }, [listing, bidHistory, liveBidCents, displayBidCents]);

  // `isLoading` already implies `listing === undefined` — UseQueryResult is a
  // discriminated union and the pending arm types `data` as undefined — so the
  // extra `&& !listing` was unreachable narrowing, not a safety net.
  if (isLoading) {
    return (
      <div className="dark bg-background relative min-h-screen overflow-y-auto text-zinc-100">
        <GradientMesh />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="space-y-4">
            <div className="h-10 w-2/3 animate-pulse rounded bg-white/5" />
            <div className="h-72 animate-pulse rounded-xl bg-white/5" />
          </div>
        </div>
      </div>
    );
  }

  if (isError && !listing) {
    return (
      <div className="dark bg-background relative min-h-screen overflow-y-auto text-zinc-100">
        <GradientMesh />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <EmptyState
            title="Failed to load listing"
            description="We could not load this auction. Check your connection and try again."
            action={
              <Button
                type="button"
                className="min-h-11"
                disabled={isFetching}
                onClick={() => {
                  void refetch();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="dark bg-background relative min-h-screen overflow-y-auto text-zinc-100">
        <GradientMesh />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <EmptyState title="Listing not found" />
        </div>
      </div>
    );
  }

  const connectionLabel = isConnected
    ? 'LIVE'
    : connectionStatus === 'connecting'
      ? 'CONNECTING'
      : 'OFFLINE';

  return (
    <div className="dark bg-background relative min-h-screen overflow-y-auto text-zinc-100">
      <GradientMesh />

      <div
        className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />

      {/* Sticky header */}
      <div className="bg-background/90 sticky top-0 z-50 border-b border-white/[0.06] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/marketplace/${listingId}` as Route}
              className="flex min-h-11 items-center gap-1.5 text-sm text-white/65 hover:text-white/85"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Listing</span>
            </Link>
            <div className="h-4 w-px bg-white/10" />
            <Badge className="gap-1 border-white/10 bg-white/5 text-xs text-white/70">
              <Radio className="h-3 w-3" aria-hidden="true" />
              SPECTATE
            </Badge>
            {/* LIVE only when the spectator socket is open — never claim live without connection (FE-06). */}
            <Badge
              className={
                isConnected
                  ? 'gap-1 border-red-500/20 bg-red-500/10 text-xs text-red-400'
                  : connectionStatus === 'connecting'
                    ? 'gap-1 border-amber-500/20 bg-amber-500/10 text-xs text-amber-300'
                    : 'gap-1 border-white/10 bg-white/5 text-xs text-white/50'
              }
              aria-live="polite"
            >
              {isConnected ? (
                <Wifi className="h-3 w-3 animate-pulse" aria-hidden="true" />
              ) : (
                <WifiOff className="h-3 w-3" aria-hidden="true" />
              )}
              {connectionLabel}
            </Badge>
            {isConnected && watcherCount > 0 ? (
              <span className="hidden text-xs text-white/45 sm:inline">
                {String(watcherCount)} watching
              </span>
            ) : null}
          </div>

          <div className="hidden items-center gap-3 text-sm md:flex">
            <h1 className="font-semibold text-white/90">{listing.title}</h1>
            {listing.pickup_zip ? (
              <div className="flex items-center gap-2 text-white/60">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {listing.pickup_city ? `${listing.pickup_city}, ` : ''}
                  {listing.pickup_state ?? ''} {listing.pickup_zip}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bloomberg-style grid */}
      <div className="relative z-[2] mx-auto grid max-w-[1400px] gap-4 px-4 py-6 sm:px-6 lg:grid-cols-3">
        {/* Big number panel */}
        <Card className="border-white/[0.06] bg-black/40 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold tracking-[0.2em] text-emerald-400 uppercase">
              CURRENT BID
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-6xl font-bold text-emerald-400 tabular-nums sm:text-7xl">
              {formatCents(displayBidCents ?? listing.current_bid_cents)}
            </p>
            <p className="mt-2 text-xs tracking-wider text-white/50 uppercase">
              Started at {formatCents(listing.starting_price_cents)} ·{' '}
              {String(listing.bidder_count)} bidders · {String(listing.bid_count)} bids
              {lastBid && isConnected ? ' · live feed' : ''}
            </p>
            <Sparkline
              data={sparklineSeries}
              width={640}
              height={100}
              className="mt-4 text-emerald-400"
            />
          </CardContent>
        </Card>

        {/* Timer panel */}
        <Card className="border-white/[0.06] bg-black/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold tracking-[0.2em] text-amber-400 uppercase">
              TIME REMAINING
            </CardTitle>
          </CardHeader>
          <CardContent>
            {listing.auction_ends_at ? (
              <div className="flex justify-center py-4">
                <AuctionTimer auctionEndsAt={listing.auction_ends_at} />
              </div>
            ) : (
              <p className="text-sm text-white/50">Auction not started</p>
            )}
            {listing.snipe_extension_count > 0 ? (
              <p className="mt-2 text-center text-[11px] tracking-wider text-amber-400 uppercase">
                Extended ×{String(listing.snipe_extension_count)}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card className="border-white/[0.06] bg-black/40 lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
              ORDER FLOW
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bidHistory && bidHistory.bids.length > 0 ? (
              <ul className="divide-y divide-white/[0.06] font-mono text-sm">
                {bidHistory.bids.slice(0, 20).map((bid) => (
                  <li key={bid.id} className="grid grid-cols-3 gap-2 py-1.5 text-xs sm:grid-cols-4">
                    <span className="truncate text-white/70">{bid.bidder_display_name}</span>
                    <span className="text-emerald-300 tabular-nums">
                      {formatCents(bid.amount_cents)}
                    </span>
                    <span className="text-white/40">
                      {formatRelativeTime(new Date(bid.created_at))}
                    </span>
                    <span
                      className={
                        bid.is_winning ? 'hidden text-emerald-500 sm:inline' : 'hidden sm:inline'
                      }
                    >
                      {bid.is_winning ? 'LEADER' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-white/40">No bids yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
