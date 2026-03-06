'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSearchProviders } from '@/hooks/useProviders';
import type { SearchProvidersParams } from '@/hooks/useProviders';

const DEFAULT_PAGE_SIZE = 12;

export default function ProvidersPage() {
  const [filters, setFilters] = useState<SearchProvidersParams>({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
  });
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading, isError } = useSearchProviders(filters);

  const currentPage = filters.page ?? 1;
  const totalPages = data?.pagination.totalPages ?? 1;

  function handleSearch() {
    setFilters({ ...filters, query: searchInput || undefined, page: 1 });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Find Providers</h1>
        <p className="mt-1 text-muted-foreground">
          Browse verified service providers in your area
        </p>
      </div>

      {/* Search */}
      <div className="mb-8 flex gap-2">
        <Input
          placeholder="Search by name, business, or category..."
          value={searchInput}
          onChange={(e) => { setSearchInput(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          className="max-w-md"
        />
        <Button onClick={handleSearch} className="min-h-[44px]">
          Search
        </Button>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`skeleton-${String(i)}`}
              className="h-48 animate-pulse rounded-xl border bg-muted"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/50 p-8 text-center">
          <p className="text-destructive">Failed to load providers. Please try again.</p>
          <Button
            variant="outline"
            className="mt-4 min-h-[44px]"
            onClick={() => { setFilters({ ...filters }); }}
          >
            Retry
          </Button>
        </div>
      ) : !data?.providers.length ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">
            No providers found matching your criteria.
          </p>
          <Button
            variant="outline"
            className="mt-4 min-h-[44px]"
            onClick={() => {
              setSearchInput('');
              setFilters({ page: 1, page_size: DEFAULT_PAGE_SIZE });
            }}
          >
            Clear Filters
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {String(data.pagination.totalCount)} provider
            {data.pagination.totalCount !== 1 ? 's' : ''} found
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.providers.map((provider) => (
              <Link
                key={provider.id}
                href={`/providers/${provider.id}`}
                className="block"
              >
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="p-5">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold">
                        {(provider.business_name ?? provider.display_name).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">
                          {provider.business_name ?? provider.display_name}
                        </p>
                        {provider.business_name ? (
                          <p className="truncate text-sm text-muted-foreground">
                            {provider.display_name}
                          </p>
                        ) : null}
                      </div>
                      {provider.verified ? (
                        <Badge variant="default" className="shrink-0 text-xs">
                          Verified
                        </Badge>
                      ) : null}
                    </div>

                    {provider.bio ? (
                      <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                        {provider.bio}
                      </p>
                    ) : null}

                    <div className="mb-3 flex items-center gap-4 text-sm">
                      {provider.review_summary ? (
                        <span className="font-medium">
                          {provider.review_summary.average_rating.toFixed(1)} stars
                          <span className="ml-1 text-muted-foreground">
                            ({String(provider.review_summary.review_count)})
                          </span>
                        </span>
                      ) : null}
                      {provider.trust_score ? (
                        <Badge variant="outline" className="text-xs">
                          {provider.trust_score.tier.replace('_', ' ')}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {provider.service_categories.slice(0, 3).map((cat) => (
                        <Badge key={cat.id} variant="secondary" className="text-xs">
                          {cat.name}
                        </Badge>
                      ))}
                      {provider.service_categories.length > 3 ? (
                        <Badge variant="secondary" className="text-xs">
                          +{String(provider.service_categories.length - 3)} more
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">
                      {String(provider.jobs_completed)} jobs completed
                    </div>
                  </CardContent>
                </Card>
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
                className="min-h-[44px]"
              >
                Previous
              </Button>
              <span className="px-4 text-sm text-muted-foreground">
                Page {String(currentPage)} of {String(totalPages)}
              </span>
              <Button
                variant="outline"
                disabled={!data.pagination.hasNext}
                onClick={() => {
                  setFilters({ ...filters, page: currentPage + 1 });
                }}
                className="min-h-[44px]"
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
