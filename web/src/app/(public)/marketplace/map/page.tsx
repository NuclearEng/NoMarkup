'use client';

/**
 * /marketplace/map — full-bleed Mapbox view of every active listing.
 *
 * Layout:
 *  - Desktop (≥lg): map fills the left two-thirds of the viewport, a side
 *    panel on the right lists every listing currently inside the map's
 *    bounds, sorted by ending-soonest. Scroll-snapped, click-to-zoom on
 *    the map.
 *  - Mobile (<lg): map fills the screen with a swipe-up sheet at the
 *    bottom that exposes the same list (peek 80px, expand to 60vh).
 *
 * Data flow:
 *   - Loads up to 200 nearby listings via useListings() with a wide page_size
 *     and `sort_by=ending_soon`. Agent B's PostGIS lat/lng/radius_km filter
 *     is wired upstream — passing them through here would re-narrow the
 *     map, which we don't want; the map is meant to be a city-wide view.
 *   - The map fires onViewportChange(bounds) on `moveend`; the panel
 *     filters its visible-list to listings inside those bounds.
 */

import { ArrowLeft, MapPin, Package } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { CountdownClock } from '@/components/marketplace/CountdownClock';
import {
  MarketplaceMap,
  type MapBounds,
} from '@/components/marketplace/MarketplaceMap';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useListings } from '@/hooks/useListings';
import { formatCents } from '@/lib/utils';
import type { Listing } from '@/types';

export default function MarketplaceMapPage() {
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useListings({
    page: 1,
    page_size: 200,
    sort_by: 'ending_soon',
  });

  // Memoize so identity is stable for downstream effect dependencies in
  // <MarketplaceMap>; without it the map would tear down + rebuild markers
  // on every parent render.
  const listings = useMemo(() => data?.listings ?? [], [data]);

  // Visible-in-viewport filter — when a viewport hasn't been reported yet
  // we show every listing with coordinates so the panel isn't empty on the
  // first paint.
  const visible = useMemo(() => {
    const withCoords = listings.filter(
      (l) => l.pickup_lat != null && l.pickup_lng != null,
    );
    if (!bounds) return withCoords;
    return withCoords.filter(
      (l) =>
        (l.pickup_lat as number) <= bounds.north &&
        (l.pickup_lat as number) >= bounds.south &&
        (l.pickup_lng as number) <= bounds.east &&
        (l.pickup_lng as number) >= bounds.west,
    );
  }, [listings, bounds]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-[#070b14] lg:h-[calc(100vh-4rem)]">
      {/* Header strip */}
      <div className="border-b border-white/5 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={'/marketplace' as Route}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to scoreboard
          </Link>
          <h1 className="flex items-center gap-2 text-base font-bold text-zinc-100 sm:text-lg">
            <MapPin
              className="h-4 w-4 text-[var(--brand-gold)]"
              aria-hidden="true"
            />
            Map view
          </h1>
          <span
            className="hidden text-xs text-zinc-500 sm:inline"
            aria-live="polite"
          >
            {String(visible.length)} in view
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Map */}
        <div className="relative flex-1 lg:flex-[2]">
          {isError ? (
            <div className="p-6">
              <EmptyState
                icon={<Package className="h-8 w-8" aria-hidden="true" />}
                title="Failed to load map"
                description="Something went wrong while fetching listings. Check your connection and try again."
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
                className="border-destructive/30"
              />
            </div>
          ) : (
            <MarketplaceMap
              listings={listings}
              onViewportChange={setBounds}
              className="h-full w-full"
            />
          )}
        </div>

        {/* Side panel — desktop */}
        <aside
          className="hidden w-full max-w-md overflow-y-auto border-l border-white/5 bg-[#070b14] lg:block lg:w-[420px]"
          aria-label="Listings in current map view"
        >
          <SidePanelList
            visible={visible}
            isLoading={isLoading}
          />
        </aside>

        {/* Mobile swipe-up sheet */}
        <div
          className={`lg:hidden ${sheetOpen ? 'h-[60vh]' : 'h-[80px]'} relative w-full overflow-hidden border-t border-white/10 bg-[#070b14] transition-[height] duration-200`}
          aria-hidden={false}
        >
          <button
            type="button"
            className="flex h-[40px] w-full items-center justify-center gap-2 text-xs font-semibold tracking-wide text-zinc-300 uppercase"
            onClick={() => {
              setSheetOpen((v) => !v);
            }}
            aria-expanded={sheetOpen}
            aria-controls="map-sheet-list"
          >
            <span className="block h-1 w-12 rounded-full bg-zinc-700" aria-hidden="true" />
            <span>{String(visible.length)} in view {sheetOpen ? '' : '(tap to expand)'}</span>
          </button>
          <div
            id="map-sheet-list"
            className="h-[calc(60vh-40px)] overflow-y-auto px-3 pb-6"
          >
            <SidePanelList visible={visible} isLoading={isLoading} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

function SidePanelList({
  visible,
  isLoading,
  compact = false,
}: {
  visible: Listing[];
  isLoading: boolean;
  compact?: boolean;
}) {
  if (isLoading) {
    return (
      <ul className={compact ? 'space-y-2 py-2' : 'space-y-2 p-4'}>
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={`map-side-skel-${String(i)}`}
            className="glass animate-pulse rounded-lg border border-white/[0.06] p-3"
          >
            <div className="h-4 w-2/3 rounded bg-white/[0.06]" />
            <div className="mt-2 h-3 w-1/3 rounded bg-white/[0.06]" />
          </li>
        ))}
      </ul>
    );
  }

  if (visible.length === 0) {
    return (
      <div className={compact ? 'p-3' : 'p-6'}>
        <p className="text-sm text-zinc-400">
          No listings inside the current map view. Pan or zoom out to see more.
        </p>
      </div>
    );
  }

  return (
    <ul className={compact ? 'space-y-2 py-2' : 'space-y-2 p-4'}>
      {visible.map((l) => (
        <li key={l.id}>
          <Link
            href={(`/marketplace/${l.id}`) as Route}
            className="glass glass-highlight block rounded-lg border border-white/[0.06] p-3 transition hover:border-[var(--brand-gold)]/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-sm font-semibold text-zinc-100">
                  {l.title}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {l.pickup_city ?? l.pickup_zip}
                </p>
              </div>
              <span className="text-sm font-bold text-[var(--brand-gold)] tabular-nums">
                {formatCents(l.current_bid_cents)}
              </span>
            </div>
            {l.auction_ends_at ? (
              <div className="mt-2 text-[10px] text-zinc-500">
                <CountdownClock endsAt={l.auction_ends_at} />
              </div>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
