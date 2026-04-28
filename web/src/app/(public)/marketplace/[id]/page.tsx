'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Clock, MapPin, Radio, Tag, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BuyItNowButton } from '@/components/marketplace/BuyItNowButton';
import { ListingBidPanel } from '@/components/marketplace/ListingBidPanel';
import { ListingPhotoCarousel } from '@/components/marketplace/ListingPhotoCarousel';
import { SimilarListings } from '@/components/marketplace/SimilarListings';
import { SnipeExtensionBanner } from '@/components/marketplace/SnipeExtensionBanner';
import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { Sparkline } from '@/components/ui/sparkline';
import { extractBidBondRequirement } from '@/hooks/useCompliance';
import { useCountdown } from '@/hooks/useCountdown';
import {
  useListing,
  useListingBids,
  usePlaceListingBid,
} from '@/hooks/useListings';
import { useMarketplaceSpectator } from '@/hooks/useMarketplaceSpectator';
import { useRecordRecentView } from '@/hooks/useRecentlyViewed';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { LISTING_STATUS } from '@/types';

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const listingId = params.id;

  const { data: listing, isLoading, isError, refetch } = useListing(listingId);
  const { data: bidHistory } = useListingBids(listingId);
  const placeBid = usePlaceListingBid();
  const { isExpired } = useCountdown(listing?.auction_ends_at);

  // Bid-bond pre-auth: when the gateway returns 402 with a
  // `requires_bid_bond` envelope we capture it here so the bid panel
  // can render the inline Stripe Elements flow. The pending-bid amount
  // is replayed once the bond is authorized.
  const [bidBondReq, setBidBondReq] = useState<{ bond_amount_cents: number } | null>(null);
  const [pendingBid, setPendingBid] = useState<{ amount: number; max?: number } | null>(null);

  // Track this listing in localStorage so it shows up on the marketplace
  // homepage's "Recently viewed" rail. No-op when listingId is empty.
  useRecordRecentView(listingId);

  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // ─── Live spectator stream ───────────────────────────────────────
  const { isConnected: liveConnected, watcherCount, lastBid } = useMarketplaceSpectator(listingId);
  const queryClient = useQueryClient();

  // When a live bid arrives, invalidate cached queries so the listing detail
  // refetches with the new high bid + bid_count, and the bid history reloads.
  useEffect(() => {
    if (!lastBid || !listingId) return;
    void queryClient.invalidateQueries({ queryKey: ['listings', listingId] });
    void queryClient.invalidateQueries({ queryKey: ['listings', listingId, 'bids'] });
  }, [lastBid, listingId, queryClient]);

  // Track previous "winning" state so we can fire an outbid toast when the
  // value flips from true → false during this session.
  const prevWinning = usePreviousWinningState(listing?.is_user_winning ?? false);
  useEffect(() => {
    if (!listing) return;
    if (prevWinning && !listing.is_user_winning && listing.was_outbid) {
      toast.error('You were outbid! Place another bid to take the lead.');
    }
  }, [listing, prevWinning]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="bg-muted h-8 w-2/3 animate-pulse rounded" />
          <div className="bg-muted aspect-[4/3] animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !listing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={<Tag className="h-8 w-8" aria-hidden="true" />}
          title="Listing not found"
          description="This listing could not be loaded. It may have been removed, or there was a connection issue."
          action={
            <div className="flex items-center gap-3">
              <Button
                variant="default"
                className="min-h-[44px]"
                onClick={() => {
                  void refetch();
                }}
              >
                Retry
              </Button>
              <Link href={'/marketplace' as Route}>
                <Button variant="outline" className="min-h-[44px]">
                  Back to Marketplace
                </Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const isOwnListing = user?.id === listing.seller_id;
  const auctionExpired = isExpired || listing.status !== LISTING_STATUS.ACTIVE;

  const sparklineSeries =
    bidHistory && bidHistory.bids.length > 0
      ? [listing.starting_price_cents, ...bidHistory.bids.map((b) => b.amount_cents).reverse()]
      : [listing.starting_price_cents, listing.current_bid_cents];

  return (
    <div className="animate-fade-in mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="text-muted-foreground mb-4 hidden items-center gap-1 text-sm sm:flex"
      >
        <Link
          href={'/marketplace' as Route}
          className="hover:text-foreground inline-flex min-h-[44px] items-center px-1"
        >
          Marketplace
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="text-foreground truncate">{listing.title}</span>
      </nav>

      {/* Mobile back */}
      <Link
        href={'/marketplace' as Route}
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 sm:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to marketplace
      </Link>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Photos column */}
        <div className="space-y-4 lg:col-span-3">
          <ListingPhotoCarousel photos={listing.photos} alt={listing.title} />

          {/* Title row */}
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{listing.title}</h1>
              <Badge variant={listing.status === 'active' ? 'active' : 'secondary'}>
                {listing.status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <p className="text-sm text-zinc-400">
              Posted {formatRelativeTime(new Date(listing.created_at))}
            </p>
          </div>

          {/* Category + pickup */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-300">
            <div className="flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-zinc-500" aria-hidden="true" />
              <span>{listing.category_name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-zinc-500" aria-hidden="true" />
              <span>
                {listing.pickup_city ? `${listing.pickup_city}, ` : ''}
                {listing.pickup_state ?? ''} {listing.pickup_zip}
              </span>
            </div>
          </div>

          <Separator />

          {/* Description */}
          <div>
            <h2 className="mb-2 text-lg font-semibold text-zinc-100">Description</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-300">
              {listing.description}
            </p>
          </div>

          <Separator />

          {/* Pickup info */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-base">Pickup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-zinc-300">
                <span className="font-medium">Zip:</span> {listing.pickup_zip}
              </p>
              {listing.pickup_address ? (
                <p className="text-zinc-300">
                  <span className="font-medium">Address:</span> {listing.pickup_address}
                </p>
              ) : (
                <p className="text-zinc-500">
                  Full pickup address is shared with the winning bidder after the auction ends.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Bid history */}
          {bidHistory && bidHistory.bids.length > 0 ? (
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-base">Bid history</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline
                  data={sparklineSeries}
                  width={520}
                  height={60}
                  className="mb-3 text-[var(--brand-gold)]"
                />
                <ul className="divide-y divide-white/[0.06]">
                  {bidHistory.bids.slice(0, 8).map((bid) => (
                    <li key={bid.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="truncate text-zinc-300">
                        {bid.bidder_display_name}{' '}
                        {bid.is_winning ? (
                          <span className="ml-1 text-[10px] font-semibold text-emerald-400 uppercase">
                            Winning
                          </span>
                        ) : null}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-zinc-100 tabular-nums">
                          {formatCents(bid.amount_cents)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {formatRelativeTime(new Date(bid.created_at))}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-4 lg:col-span-2">
          {/* Snipe extension banner */}
          {listing.snipe_extension_count > 0 && listing.auction_ends_at ? (
            <SnipeExtensionBanner
              extensionCount={listing.snipe_extension_count}
              newEndTime={listing.auction_ends_at}
            />
          ) : null}

          {/* Hero auction status */}
          <Card variant="glass" className="border-[var(--brand-gold)]/20">
            <CardHeader className="pb-2">
              <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                Current bid
              </p>
              <div className="flex items-baseline justify-between gap-3">
                <CardTitle
                  className="text-3xl font-bold text-[var(--brand-gold)] tabular-nums"
                  style={{
                    textShadow:
                      '0 0 20px rgba(212,160,23,0.3), 0 0 40px rgba(212,160,23,0.15)',
                  }}
                >
                  {formatCents(listing.current_bid_cents)}
                </CardTitle>
                <span className="text-xs text-zinc-500">
                  Started at {formatCents(listing.starting_price_cents)}
                </span>
              </div>
              {/* Reserve-not-met badge — only render when the listing has
                  a reserve set AND it has not yet been crossed. Hidden
                  reserve price is intentional; we only surface the gate. */}
              {listing.reserve_price_cents != null && listing.reserve_met === false ? (
                <div className="mt-2">
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-amber-200"
                  >
                    Reserve not met
                  </Badge>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {listing.auction_ends_at ? (
                <div className="flex items-center justify-center">
                  <AuctionTimer auctionEndsAt={listing.auction_ends_at} />
                </div>
              ) : (
                <p className="text-center text-sm text-zinc-500">Auction not started</p>
              )}

              <div className="flex items-center justify-around border-t border-white/[0.06] pt-3 text-sm text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                  <span className="font-semibold">{String(listing.bidder_count)}</span>
                  <span className="text-zinc-500">
                    bidder{listing.bidder_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                  <span className="font-semibold">{String(listing.bid_count)}</span>
                  <span className="text-zinc-500">bid{listing.bid_count !== 1 ? 's' : ''}</span>
                </div>
                <div
                  className="flex items-center gap-1.5"
                  aria-live="polite"
                  aria-label={`${String(watcherCount)} watching now`}
                >
                  <span
                    className={
                      liveConnected
                        ? 'inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400'
                        : 'inline-block h-2 w-2 rounded-full bg-zinc-600'
                    }
                    aria-hidden="true"
                  />
                  <span className="font-semibold tabular-nums">{String(watcherCount)}</span>
                  <span className="text-zinc-500">live</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Buy It Now — fixed-price closeout (only when seller set a BIN) */}
          <BuyItNowButton listing={listing} />

          {/* Bid panel */}
          <ListingBidPanel
            currentBidCents={listing.current_bid_cents}
            minIncrementCents={listing.min_increment_cents}
            isAuthenticated={isAuthenticated}
            isOwnListing={isOwnListing}
            isUserWinning={listing.is_user_winning}
            isAuctionExpired={auctionExpired}
            isSubmitting={placeBid.isPending}
            lastLiveBidTimestamp={lastBid?.timestamp ?? null}
            lastLiveBidExtended={lastBid?.snipe_extension ?? false}
            listingId={listingId}
            bidBondRequirement={bidBondReq}
            onBidBondAuthorized={() => {
              if (pendingBid) {
                placeBid.mutate({
                  listingId,
                  input: {
                    amount_cents: pendingBid.amount,
                    ...(pendingBid.max ? { max_bid_cents: pendingBid.max } : {}),
                  },
                });
              }
              setBidBondReq(null);
              setPendingBid(null);
            }}
            onPlaceBid={(amountCents, maxBidCents) => {
              setPendingBid({ amount: amountCents, max: maxBidCents });
              placeBid.mutate(
                {
                  listingId,
                  input: {
                    amount_cents: amountCents,
                    ...(maxBidCents ? { max_bid_cents: maxBidCents } : {}),
                  },
                },
                {
                  onSuccess: () => {
                    setBidBondReq(null);
                    setPendingBid(null);
                  },
                  onError: (err) => {
                    const req = extractBidBondRequirement(err);
                    if (req) {
                      setBidBondReq({ bond_amount_cents: req.bond_amount_cents });
                    }
                  },
                },
              );
            }}
          />

          {/* Seller card */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-base">Seller</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium text-zinc-100">{listing.seller_display_name}</p>
              <p className="text-zinc-400">
                Member since{' '}
                {new Date(listing.seller_member_since).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <p className="text-zinc-400">
                {String(listing.seller_listings_count)} listing
                {listing.seller_listings_count !== 1 ? 's' : ''}
              </p>
              {listing.seller_trust_tier ? (
                <Badge variant="outline" className="mt-1 capitalize">
                  {listing.seller_trust_tier.replace(/_/g, ' ')} seller
                </Badge>
              ) : null}
            </CardContent>
          </Card>

          {/* Spectate link */}
          <Link
            href={`/marketplace/${listingId}/spectate` as Route}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300 hover:bg-white/[0.08]"
          >
            <Radio className="h-4 w-4" aria-hidden="true" />
            Watch live (terminal view)
          </Link>
        </div>
      </div>

      {/* Similar items rail — Meilisearch-ranked, hidden when none match. */}
      <SimilarListings listingId={listingId} />
    </div>
  );
}

function usePreviousWinningState(currentValue: boolean): boolean {
  const [previous, setPrevious] = useState(currentValue);
  useEffect(() => {
    setPrevious(currentValue);
  }, [currentValue]);
  return previous;
}
