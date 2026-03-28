'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PriceHeatMap } from '@/components/maps/PriceHeatMap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  usePricingOverview,
  usePricingByCategory,
} from '@/hooks/usePricing';
import type { PricingOverviewCategory } from '@/hooks/usePricing';
import { formatCents } from '@/lib/utils';

export function PricingPageContent() {
  const [zipCode, setZipCode] = useState('');
  const [appliedZip, setAppliedZip] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PricingOverviewCategory | null>(null);

  const { data: overview, isLoading: overviewLoading, isError: overviewError } = usePricingOverview();

  const {
    data: categoryData,
    isLoading: categoryLoading,
    isError: categoryError,
  } = usePricingByCategory(
    selectedCategory?.category_slug ?? '',
    appliedZip || undefined,
  );

  function handleZipSearch() {
    const trimmed = zipCode.trim();
    setAppliedZip(trimmed);
  }

  function handleClearZip() {
    setZipCode('');
    setAppliedZip('');
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Fair Price Index
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          What does home service cost in your area? Real prices from completed jobs.
        </p>
      </div>

      {/* ZIP code search */}
      <div className="mb-8 rounded-lg border bg-card p-6">
        <label
          htmlFor="zip-search"
          className="mb-2 block text-sm font-medium"
        >
          Filter by ZIP code
        </label>
        <div className="flex gap-2">
          <Input
            id="zip-search"
            type="text"
            inputMode="numeric"
            placeholder="Enter your ZIP code..."
            value={zipCode}
            onChange={(e) => { setZipCode(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleZipSearch();
            }}
            className="max-w-xs"
            autoComplete="postal-code"
          />
          <Button onClick={handleZipSearch} className="min-h-[44px]">
            Search
          </Button>
          {appliedZip ? (
            <Button
              variant="outline"
              onClick={handleClearZip}
              className="min-h-[44px]"
            >
              Clear
            </Button>
          ) : null}
        </div>
        {appliedZip ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Showing prices for ZIP code <span className="font-medium">{appliedZip}</span>
          </p>
        ) : null}
      </div>

      {/* Neighborhood price heat map */}
      <div className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">Price heat map</h2>
        <PriceHeatMap
          categorySlug={selectedCategory?.category_slug}
          className="h-[400px]"
        />
      </div>

      {/* Selected category detail */}
      {selectedCategory ? (
        <CategoryDetail
          category={selectedCategory}
          data={categoryData?.prices ?? []}
          isLoading={categoryLoading}
          isError={categoryError}
          appliedZip={appliedZip}
          onBack={() => { setSelectedCategory(null); }}
        />
      ) : (
        /* Category overview grid */
        <CategoryOverview
          categories={overview?.categories ?? []}
          isLoading={overviewLoading}
          isError={overviewError}
          onSelect={setSelectedCategory}
        />
      )}

      {/* CTA */}
      <div className="mt-12 rounded-lg border bg-card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Get these prices for your next project
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
          Post your job on NoMarkup and let providers compete for your business.
          Our reverse-auction model means you always get a fair price.
        </p>
        <Link href="/register">
          <Button size="lg" className="mt-6 min-h-[44px]">
            Post Your Job — It&apos;s Free
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category overview grid                                            */
/* ------------------------------------------------------------------ */

function CategoryOverview({
  categories,
  isLoading,
  isError,
  onSelect,
}: {
  categories: PricingOverviewCategory[];
  isLoading: boolean;
  isError: boolean;
  onSelect: (cat: PricingOverviewCategory) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={`skeleton-${String(i)}`}
            className="h-40 rounded-xl border"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 p-8 text-center">
        <p className="text-destructive">
          Failed to load pricing data. Please try again.
        </p>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center">
        <p className="text-muted-foreground">
          No pricing data available yet. Check back soon as more jobs are completed.
        </p>
      </div>
    );
  }

  return (
    <>
      <h2 className="mb-4 text-xl font-semibold">
        Service categories
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <button
            key={cat.category_slug}
            type="button"
            onClick={() => { onSelect(cat); }}
            className="text-left"
          >
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="p-5">
                <p className="text-lg font-semibold">{cat.category_name}</p>

                <p className="mt-2 text-2xl font-bold tabular-nums">
                  {formatCents(cat.avg_median_cents)}
                </p>
                <p className="text-sm text-muted-foreground">
                  median price
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {String(cat.total_jobs)} completed job{cat.total_jobs !== 1 ? 's' : ''}
                  </Badge>
                  {cat.avg_savings_cents != null && cat.avg_savings_cents > 0 ? (
                    <Badge variant="default" className="text-xs">
                      Avg. savings {formatCents(cat.avg_savings_cents)}
                    </Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Category detail view                                              */
/* ------------------------------------------------------------------ */

import type { PricingData } from '@/hooks/usePricing';

function CategoryDetail({
  category,
  data,
  isLoading,
  isError,
  appliedZip,
  onBack,
}: {
  category: PricingOverviewCategory;
  data: PricingData[];
  isLoading: boolean;
  isError: boolean;
  appliedZip: string;
  onBack: () => void;
}) {
  return (
    <div>
      <Button
        variant="outline"
        onClick={onBack}
        className="mb-6 min-h-[44px]"
      >
        &larr; All categories
      </Button>

      <h2 className="text-2xl font-bold tracking-tight">
        {category.category_name} pricing
      </h2>
      <p className="mt-1 text-muted-foreground">
        Based on {String(category.total_jobs)} completed job
        {category.total_jobs !== 1 ? 's' : ''} on NoMarkup
        {appliedZip ? ` in ${appliedZip}` : ''}
      </p>

      {isLoading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={`detail-skeleton-${String(i)}`}
              className="h-56 rounded-xl border"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-6 rounded-lg border border-destructive/50 p-8 text-center">
          <p className="text-destructive">
            Failed to load pricing breakdown. Please try again.
          </p>
        </div>
      ) : data.length === 0 ? (
        <div className="mt-6 rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">
            {appliedZip
              ? `No pricing data available for ZIP code ${appliedZip}. Try a different ZIP or clear the filter.`
              : 'No pricing data available for this category yet.'}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((row) => (
            <Card key={`${row.category_slug}-${row.zip_code}`}>
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold">{row.zip_code}</p>
                  <Badge variant="secondary" className="text-xs">
                    {String(row.completed_jobs)} job{row.completed_jobs !== 1 ? 's' : ''}
                  </Badge>
                </div>

                {/* Price range bar */}
                <div className="mb-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Median</span>
                    <span className="text-2xl font-bold tabular-nums">
                      {formatCents(row.median_price_cents)}
                    </span>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Budget-friendly (25th pct)</span>
                    <span className="font-medium tabular-nums">
                      {formatCents(row.p25_price_cents)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Typical (50th pct)</span>
                    <span className="font-medium tabular-nums">
                      {formatCents(row.median_price_cents)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Premium (75th pct)</span>
                    <span className="font-medium tabular-nums">
                      {formatCents(row.p75_price_cents)}
                    </span>
                  </div>

                  <div className="my-2 border-t" />

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Range</span>
                    <span className="font-medium tabular-nums">
                      {formatCents(row.min_price_cents)} &ndash; {formatCents(row.max_price_cents)}
                    </span>
                  </div>

                  {row.avg_savings_cents != null && row.avg_savings_cents > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg. savings vs. budget</span>
                      <span className="font-medium tabular-nums text-green-600">
                        {formatCents(row.avg_savings_cents)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
