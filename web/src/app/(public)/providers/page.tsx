'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ResponseTimeBadge } from '@/components/providers/ResponseTimeBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useSearchProviders } from '@/hooks/useProviders';
import type { SearchProvidersParams } from '@/hooks/useProviders';

const DEFAULT_PAGE_SIZE = 12;

function ProviderSearchIllustration() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="20" cy="16" r="8" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M8 40C8 32.268 14.268 26 22 26H26C33.732 26 40 32.268 40 40"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <circle cx="36" cy="14" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path
        d="M30 36L42 36"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}

function ErrorIllustration() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
      <path d="M16 10V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="22" r="1.5" fill="currentColor" />
    </svg>
  );
}

function ProviderCardSkeleton() {
  return (
    <div className="glass glass-highlight animate-pulse rounded-xl border border-[var(--brand-gold)]/10 p-5">
      {/* Avatar + name row */}
      <div className="mb-3 flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-full bg-white/[0.06]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-white/[0.06]" />
          <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
        </div>
        <div className="h-5 w-16 rounded-full bg-white/[0.06]" />
      </div>
      {/* Bio lines */}
      <div className="mb-3 space-y-2">
        <div className="h-3 w-full rounded bg-white/[0.04]" />
        <div className="h-3 w-4/5 rounded bg-white/[0.04]" />
      </div>
      {/* Rating + trust badge */}
      <div className="mb-3 flex items-center gap-4">
        <div className="h-4 w-20 rounded bg-white/[0.06]" />
        <div className="h-5 w-14 rounded-full bg-white/[0.06]" />
      </div>
      {/* Category badges */}
      <div className="flex gap-1">
        <div className="h-5 w-16 rounded-full bg-white/[0.06]" />
        <div className="h-5 w-20 rounded-full bg-white/[0.06]" />
        <div className="h-5 w-14 rounded-full bg-white/[0.06]" />
      </div>
      {/* Jobs completed */}
      <div className="mt-3">
        <div className="h-3 w-28 rounded bg-white/[0.04]" />
      </div>
    </div>
  );
}

export default function ProvidersPage() {
  const [filters, setFilters] = useState<SearchProvidersParams>({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
  });
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading, isError, refetch } = useSearchProviders(filters);

  const currentPage = filters.page ?? 1;
  const totalPages = data?.pagination.totalPages ?? 1;

  function handleSearch() {
    setFilters({ ...filters, query: searchInput || undefined, page: 1 });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="animate-fade-in-up mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-100">
          Find <span className="gold-text">Providers</span>
        </h1>
        <p className="mt-2 text-lg text-zinc-300">
          Browse verified service providers in your area
        </p>
      </div>

      {/* Search */}
      <div className="mb-8 flex gap-2">
        <Input
          placeholder="Search by name, business, or category..."
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          className="glass-input max-w-md min-h-[44px] text-zinc-200 placeholder:text-zinc-500"
        />
        <Button onClick={handleSearch} className="glass-cta-gold min-h-[44px] rounded-xl px-5 text-sm font-semibold">
          Search
        </Button>
      </div>

      {/* Results */}
      <div className="animate-fade-in">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProviderCardSkeleton key={`skeleton-${String(i)}`} />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={<ErrorIllustration />}
            title="Failed to load providers"
            description="We couldn't fetch provider listings right now. Please check your connection and try again."
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
        ) : !data?.providers.length ? (
          <EmptyState
            icon={<ProviderSearchIllustration />}
            title="No providers found"
            description={
              searchInput
                ? `No providers match "${searchInput}". Try a different search term or clear your filters.`
                : 'No providers are listed yet. Check back soon as new providers join.'
            }
            action={
              searchInput ? (
                <Button
                  variant="default"
                  className="min-h-[44px]"
                  onClick={() => {
                    setSearchInput('');
                    setFilters({ page: 1, page_size: DEFAULT_PAGE_SIZE });
                  }}
                >
                  Clear Filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-400">
              {String(data.pagination.totalCount)} provider
              {data.pagination.totalCount !== 1 ? 's' : ''} found
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.providers.map((provider) => (
                <Link key={provider.id} href={`/providers/${provider.id}`} className="block">
                  <div className="glass glass-highlight glass-interactive h-full rounded-xl border border-[var(--brand-gold)]/10 p-5">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--brand-gold)]/10 text-lg font-semibold text-[var(--brand-gold)]">
                        {(provider.business_name ?? provider.display_name)
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-zinc-100">
                          {provider.business_name ?? provider.display_name}
                        </p>
                        {provider.business_name ? (
                          <p className="truncate text-sm text-zinc-400">
                            {provider.display_name}
                          </p>
                        ) : null}
                      </div>
                      {provider.verified ? (
                        <Badge variant="default" className="shrink-0 border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/10 text-xs text-[var(--brand-gold)]">
                          Verified
                        </Badge>
                      ) : null}
                    </div>

                    {provider.bio ? (
                      <p className="mb-3 line-clamp-2 text-sm text-zinc-400">
                        {provider.bio}
                      </p>
                    ) : null}

                    <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
                      {provider.review_summary ? (
                        <span className="font-medium text-zinc-200">
                          {provider.review_summary.average_rating.toFixed(1)} stars
                          <span className="ml-1 text-zinc-500">
                            ({String(provider.review_summary.review_count)})
                          </span>
                        </span>
                      ) : null}
                      {provider.trust_score ? (
                        <Badge variant="outline" className="border-[var(--brand-gold)]/20 text-xs text-zinc-300">
                          {provider.trust_score.tier.replace('_', ' ')}
                        </Badge>
                      ) : null}
                    </div>

                    {provider.response_time_label ? (
                      <div className="mb-3">
                        <ResponseTimeBadge label={provider.response_time_label} />
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-1">
                      {(provider.service_categories ?? []).slice(0, 3).map((cat) => (
                        <Badge key={cat.id} variant="secondary" className="border-white/10 bg-white/[0.06] text-xs text-zinc-300">
                          {cat.name}
                        </Badge>
                      ))}
                      {(provider.service_categories ?? []).length > 3 ? (
                        <Badge variant="secondary" className="border-white/10 bg-white/[0.06] text-xs text-zinc-400">
                          +{String(provider.service_categories.length - 3)} more
                        </Badge>
                      ) : null}
                    </div>

                    <div className="glass-divider mt-3 mb-2" />
                    <div className="text-xs text-zinc-500">
                      {String(provider.jobs_completed)} jobs completed
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 ? (
              <nav
                aria-label="Provider results pagination"
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
  );
}
