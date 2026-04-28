'use client';

import { Package, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

import { ListingCard } from '@/components/marketplace/ListingCard';
import { ListingFilters } from '@/components/marketplace/ListingFilters';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useListings } from '@/hooks/useListings';
import type { SearchListingsParams } from '@/types';

const DEFAULT_PAGE_SIZE = 12;

export default function MarketplacePage() {
  const [filters, setFilters] = useState<SearchListingsParams>({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    sort_by: 'ending_soon',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useListings(filters);

  const currentPage = filters.page ?? 1;
  const totalPages = data?.pagination.totalPages ?? 1;

  const hasActiveFilters =
    filters.query !== undefined ||
    filters.category_id !== undefined ||
    filters.pickup_zip !== undefined ||
    filters.radius_km !== undefined ||
    filters.min_price_cents !== undefined ||
    filters.max_price_cents !== undefined ||
    filters.ending_soon === true;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="animate-fade-in-up mb-6">
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-100">
          Goods <span className="gold-text">Marketplace</span>
        </h1>
        <p className="mt-2 text-lg text-zinc-300">
          Bid on local goods. Highest bidder wins — auctions end on a clock.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Mobile filter toggle */}
        <div className="lg:hidden">
          <Button
            variant="outline"
            className="min-h-[44px] w-full justify-between border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
            onClick={() => {
              setFiltersOpen(!filtersOpen);
            }}
            aria-expanded={filtersOpen}
            aria-controls="listing-filters-panel"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters
              {hasActiveFilters ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[10px] font-semibold text-black">
                  !
                </span>
              ) : null}
            </span>
            {filtersOpen ? <X className="h-4 w-4" aria-hidden="true" /> : null}
          </Button>
        </div>

        {/* Filters sidebar */}
        <aside
          id="listing-filters-panel"
          className={`w-full shrink-0 lg:block lg:w-72 ${filtersOpen ? 'block' : 'hidden'}`}
        >
          <div className="glass glass-highlight animate-fade-in sticky top-6 rounded-xl border border-[var(--brand-gold)]/10 p-4">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              Filters
            </h2>
            <ListingFilters filters={filters} onChange={setFilters} />
          </div>
        </aside>

        {/* Results */}
        <div className="flex-1">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={`listing-skeleton-${String(i)}`}
                  className="glass glass-highlight animate-pulse rounded-xl border border-[var(--brand-gold)]/10 p-5"
                >
                  <div className="mb-3 aspect-[4/3] w-full rounded-lg bg-white/[0.06]" />
                  <div className="mb-2 h-5 w-3/4 rounded bg-white/[0.06]" />
                  <div className="mb-4 h-3 w-5/6 rounded bg-white/[0.06]" />
                  <div className="flex items-center justify-between">
                    <div className="h-5 w-20 rounded bg-white/[0.06]" />
                    <div className="h-5 w-16 rounded bg-white/[0.06]" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              icon={<Package className="h-8 w-8" aria-hidden="true" />}
              title="Failed to load listings"
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
          ) : !data?.listings.length ? (
            <EmptyState
              icon={<Package className="h-8 w-8" aria-hidden="true" />}
              title="No listings found"
              description={
                hasActiveFilters
                  ? 'No listings match your current filters. Try widening your radius or clearing some filters.'
                  : 'There are no active listings right now. Check back soon — sellers post new items every day.'
              }
              action={
                hasActiveFilters ? (
                  <Button
                    variant="default"
                    className="min-h-[44px]"
                    onClick={() => {
                      setFilters({ page: 1, page_size: DEFAULT_PAGE_SIZE });
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <p className="mb-4 text-sm text-zinc-400">
                {String(data.pagination.totalCount)} listing
                {data.pagination.totalCount !== 1 ? 's' : ''} for sale
              </p>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>

              {totalPages > 1 ? (
                <nav
                  aria-label="Marketplace pagination"
                  className="mt-8 flex items-center justify-center gap-2"
                >
                  <Button
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => {
                      setFilters({ ...filters, page: currentPage - 1 });
                    }}
                    className="min-h-[44px] border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
                  >
                    Previous
                  </Button>
                  <span className="px-4 text-sm text-zinc-400">
                    Page {String(currentPage)} of {String(totalPages)}
                  </span>
                  <Button
                    variant="outline"
                    disabled={!data.pagination.hasNext}
                    onClick={() => {
                      setFilters({ ...filters, page: currentPage + 1 });
                    }}
                    className="min-h-[44px] border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
                  >
                    Next
                  </Button>
                </nav>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
