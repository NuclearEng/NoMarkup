'use client';

import { Package, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListingFilters } from '@/components/marketplace/ListingFilters';
import { ScoreboardCard } from '@/components/marketplace/ScoreboardCard';
import { SearchBar } from '@/components/marketplace/SearchBar';
import { UrgencyStrip } from '@/components/marketplace/UrgencyStrip';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useListings } from '@/hooks/useListings';
import type { Listing, SearchListingsParams } from '@/types';

const DEFAULT_PAGE_SIZE = 60;

type Bucket = 'critical' | 'urgent' | 'normal';

function bucketFor(endsAt: string | null, now: number): Bucket {
  if (!endsAt) return 'normal';
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 600_000) return 'critical'; // <10 min
  if (ms <= 3_600_000) return 'urgent'; // <60 min
  return 'normal';
}

export default function MarketplacePage() {
  const [filters, setFilters] = useState<SearchListingsParams>({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    sort_by: 'ending_soon',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useListings(filters);

  const hasActiveFilters =
    filters.query !== undefined ||
    filters.category_id !== undefined ||
    filters.pickup_zip !== undefined ||
    filters.radius_km !== undefined ||
    filters.min_price_cents !== undefined ||
    filters.max_price_cents !== undefined ||
    filters.ending_soon === true;

  // Bucket listings into Closing Now (red) / Closing Soon (gold) / Later Today.
  // Recompute every render — the underlying listings refresh via React Query,
  // and the bucket labels follow whatever the user last fetched. The per-card
  // CountdownClock handles second-by-second drift.
  const buckets = useMemo(() => {
    const now = Date.now();
    const all = (data?.listings ?? []) as Array<Listing & { watcher_count?: number }>;
    const critical: typeof all = [];
    const urgent: typeof all = [];
    const later: typeof all = [];
    for (const l of all) {
      const b = bucketFor(l.auction_ends_at, now);
      if (b === 'critical') critical.push(l);
      else if (b === 'urgent') urgent.push(l);
      else later.push(l);
    }
    return { critical, urgent, later };
  }, [data]);

  const closingSoonCount = buckets.critical.length + buckets.urgent.length;
  const totalWatchers = (data?.listings ?? []).reduce(
    (sum, l) => sum + ((l as Listing & { watcher_count?: number }).watcher_count ?? 0),
    0,
  );
  const liveBidsCount = (data?.listings ?? []).reduce(
    (sum, l) => sum + l.bid_count,
    0,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="animate-fade-in-up mb-6">
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-100">
          The <span className="gold-text">Live</span> Marketplace
        </h1>
        <p className="mt-2 text-lg text-zinc-300">
          Auctions are watched, not posted. Highest bidder wins on the clock.
        </p>
      </div>

      {/* Hero scoreboard strip */}
      <div className="mb-6">
        <UrgencyStrip
          closingSoonCount={closingSoonCount}
          totalWatchers={totalWatchers}
          liveBidsCount={liveBidsCount}
        />
      </div>

      {/* Autocomplete search — Meilisearch-backed typeahead. Sits above
          the filters so the search is the primary find affordance,
          while the sidebar filters remain for refinement. */}
      <div className="mb-8">
        <SearchBar
          defaultValue={filters.query ?? ''}
          onSubmitQuery={(q) => {
            setFilters((prev) => ({
              ...prev,
              query: q.length > 0 ? q : undefined,
              page: 1,
            }));
          }}
          onSelectSuggestion={(s) => {
            if (s.type === 'listing' && s.id) {
              window.location.assign(`/marketplace/${s.id}`);
              return;
            }
            if (s.type === 'category' && s.label) {
              setFilters((prev) => ({
                ...prev,
                query: s.label,
                page: 1,
              }));
            }
          }}
        />
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

        {/* Scoreboard */}
        <div className="flex-1">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={`scoreboard-skeleton-${String(i)}`}
                  className="glass glass-highlight animate-pulse rounded-xl border border-[var(--brand-gold)]/10 p-5"
                >
                  <div className="mb-3 aspect-[16/10] w-full rounded-lg bg-white/[0.06]" />
                  <div className="mb-2 h-5 w-3/4 rounded bg-white/[0.06]" />
                  <div className="mb-4 h-3 w-5/6 rounded bg-white/[0.06]" />
                  <div className="flex items-center justify-between">
                    <div className="h-7 w-24 rounded bg-white/[0.06]" />
                    <div className="h-5 w-16 rounded bg-white/[0.06]" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              icon={<Package className="h-8 w-8" aria-hidden="true" />}
              title="Failed to load auctions"
              description="Something went wrong while fetching live auctions. Check your connection and try again."
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
              title="No live auctions right now"
              description={
                hasActiveFilters
                  ? 'No auctions match your current filters. Try widening your radius or clearing some filters.'
                  : 'The room is between rounds. Check back in a few minutes — auctions launch all day.'
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
            <div className="space-y-10">
              {/* Closing Now — red urgency */}
              {buckets.critical.length > 0 ? (
                <Section
                  title="Closing Now"
                  subtitle="Last 10 minutes — bid before the gavel."
                  tone="critical"
                >
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {buckets.critical.map((listing) => (
                      <ScoreboardCard
                        key={listing.id}
                        listing={listing}
                        urgency="critical"
                      />
                    ))}
                  </div>
                </Section>
              ) : null}

              {/* Closing Soon — gold */}
              {buckets.urgent.length > 0 ? (
                <Section
                  title="Closing Soon"
                  subtitle="Within the hour. Watch counts climb fast here."
                  tone="urgent"
                >
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {buckets.urgent.map((listing) => (
                      <ScoreboardCard
                        key={listing.id}
                        listing={listing}
                        urgency="urgent"
                      />
                    ))}
                  </div>
                </Section>
              ) : null}

              {/* Later Today — normal */}
              {buckets.later.length > 0 ? (
                <Section
                  title="Later Today"
                  subtitle="Bookmark a card to get a 60-second warning before close."
                  tone="normal"
                >
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {buckets.later.map((listing) => (
                      <ScoreboardCard key={listing.id} listing={listing} />
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  tone: Bucket;
  children: React.ReactNode;
}) {
  const accent =
    tone === 'critical'
      ? 'text-red-300'
      : tone === 'urgent'
        ? 'text-amber-300'
        : 'text-zinc-400';
  return (
    <section aria-labelledby={`section-${title.replace(/\s+/g, '-')}`}>
      <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2
          id={`section-${title.replace(/\s+/g, '-')}`}
          className={`text-xl font-bold tracking-tight ${accent}`}
        >
          {title}
        </h2>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}
