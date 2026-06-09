'use client';

// /me/saved-searches — manage standing search alerts.
//
// The saved-search hooks (useSavedSearches / useCreateSavedSearch /
// useDeleteSavedSearch) had ZERO consumers before this page even though the
// backend CRUD works end-to-end. This surfaces the saved searches as a list
// with a re-run link + a delete action. (Bug 2)
//
// The persisted `query` is polymorphic (bare string for legacy rows, object
// for new rows), so every read goes through the string-or-object guards
// summarizeSavedSearchQuery / savedSearchQueryToParams — the UI never breaks
// on an unexpected shape.

import { Bell, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  savedSearchQueryToParams,
  summarizeSavedSearchQuery,
  useDeleteSavedSearch,
  useSavedSearches,
  type SavedSearch,
} from '@/hooks/useWatchlist';

const ALERT_LABELS: Record<SavedSearch['alert_frequency'], string> = {
  instant: 'Instant alerts',
  daily: 'Daily digest',
  weekly: 'Weekly digest',
  off: 'Alerts off',
};

/** Build a /marketplace href that re-runs a saved search's query. */
function marketplaceHref(search: SavedSearch): Route {
  const params = savedSearchQueryToParams(search.query);
  const sp = new URLSearchParams();
  if (params.query) sp.set('query', params.query);
  if (params.category_id) sp.set('category_id', params.category_id);
  if (params.pickup_zip) sp.set('pickup_zip', params.pickup_zip);
  if (params.min_price_cents !== undefined) sp.set('min_price_cents', String(params.min_price_cents));
  if (params.max_price_cents !== undefined) sp.set('max_price_cents', String(params.max_price_cents));
  const qs = sp.toString();
  return (`/marketplace${qs ? `?${qs}` : ''}`) as Route;
}

export default function SavedSearchesPage() {
  const { data, isLoading, isError, refetch } = useSavedSearches();
  const deleteSearch = useDeleteSavedSearch();

  const searches = data?.saved_searches ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="gold-text text-2xl font-bold">Saved searches</h1>
          <p className="mt-1 text-sm text-zinc-400">
            We'll alert you when new auctions match. Re-run a search any time.
          </p>
        </div>
        <Link
          href="/marketplace"
          className="shrink-0 text-sm text-[var(--brand-gold)] underline-offset-4 hover:underline"
        >
          Browse marketplace
        </Link>
      </header>

      {isLoading ? (
        <ul className="space-y-3" aria-busy="true" aria-live="polite">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={`saved-search-skeleton-${String(i)}`}
              className="glass glass-highlight h-20 animate-pulse rounded-xl border border-[var(--brand-gold)]/10"
            />
          ))}
        </ul>
      ) : isError ? (
        <EmptyState
          icon={<Search className="h-8 w-8" aria-hidden="true" />}
          title="Failed to load saved searches"
          description="Something went wrong while fetching your saved searches. Check your connection and try again."
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
      ) : searches.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8" aria-hidden="true" />}
          title="No saved searches yet"
          description="Run a search on the marketplace, then tap “Save this search” to get alerted when matching auctions go live."
          action={
            <Button asChild className="min-h-[44px]">
              <Link href="/marketplace">Browse marketplace</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {searches.map((search) => (
            <li
              key={search.id}
              className="glass glass-highlight flex items-center justify-between gap-4 rounded-xl border border-[var(--brand-gold)]/10 p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-zinc-100">{search.name}</p>
                <p className="mt-0.5 truncate text-sm text-zinc-400">
                  {summarizeSavedSearchQuery(search.query)}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500">
                  <Bell className="h-3 w-3" aria-hidden="true" />
                  {ALERT_LABELS[search.alert_frequency]}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button asChild variant="outline" className="min-h-[44px]">
                  <Link href={marketplaceHref(search)}>
                    <Search className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">Run</span>
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px] border-red-500/20 text-red-300 hover:bg-red-500/10"
                  disabled={deleteSearch.isPending}
                  aria-label={`Delete saved search ${search.name}`}
                  onClick={() => {
                    deleteSearch.mutate(search.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
