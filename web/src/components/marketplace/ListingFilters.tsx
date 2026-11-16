'use client';

import { useMemo, useState } from 'react';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GoodsCategorySelector } from '@/components/marketplace/GoodsCategorySelector';
import { MarketSelector } from '@/components/location/MarketSelector';
import { useGoodsCategoryTree } from '@/hooks/useCategories';
import { useSelectedMarket } from '@/hooks/useSelectedMarket';
import type { SearchListingsParams, ServiceCategory } from '@/types';

/**
 * Walk the goods category tree to resolve a category id to its display name, so
 * the compact popover trigger can show the current selection without a second
 * fetch. Goods categories are DB-driven (useGoodsCategoryTree) — there is no
 * longer a hardcoded array to map against.
 */
function findCategoryName(cats: ServiceCategory[] | undefined, id: string): string | null {
  if (!cats) return null;
  for (const cat of cats) {
    if (cat.id === id) return cat.name;
    if (cat.children && cat.children.length > 0) {
      const found = findCategoryName(cat.children, id);
      if (found) return found;
    }
  }
  return null;
}

interface ListingFiltersProps {
  filters: SearchListingsParams;
  onChange: (next: SearchListingsParams) => void;
}

export function ListingFilters({ filters, onChange }: ListingFiltersProps) {
  const [selectedMarket, setMarket] = useSelectedMarket();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const { data: goodsTree } = useGoodsCategoryTree();

  const selectedCategoryName = useMemo(
    () =>
      filters.category_id !== undefined
        ? findCategoryName(goodsTree, filters.category_id)
        : null,
    [goodsTree, filters.category_id],
  );

  function updateFilter<K extends keyof SearchListingsParams>(
    key: K,
    value: SearchListingsParams[K] | undefined,
  ) {
    const next: SearchListingsParams = { ...filters, page: 1 };
    if (value === undefined || value === '') {
      // Strip the key entirely so empty filters don't leak into the URL
      // search params (URLSearchParams would coerce undefined to "undefined").
      next[key] = undefined as SearchListingsParams[K];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  const hasAnyFilter =
    filters.query !== undefined ||
    filters.category_id !== undefined ||
    filters.pickup_zip !== undefined ||
    filters.radius_km !== undefined ||
    filters.min_price_cents !== undefined ||
    filters.max_price_cents !== undefined ||
    filters.ending_soon === true;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="listing-search-query" className="text-xs uppercase text-zinc-400">
          Search
        </Label>
        <Input
          id="listing-search-query"
          variant="glass"
          placeholder="Find anything..."
          value={filters.query ?? ''}
          onChange={(e) => {
            updateFilter('query', e.target.value || undefined);
          }}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="listing-category" className="text-xs uppercase text-zinc-400">
          Category
        </Label>
        <div className="flex items-center gap-2">
          <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                id="listing-category"
                variant="outline"
                className="min-h-[44px] flex-1 justify-start border-white/10 text-left font-normal text-zinc-200"
                aria-expanded={categoryOpen}
              >
                {selectedCategoryName ?? 'All categories'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
              <GoodsCategorySelector
                value={filters.category_id ?? null}
                onChange={(id) => {
                  updateFilter('category_id', id);
                  setCategoryOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {filters.category_id !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] shrink-0 px-3 text-zinc-400 hover:text-zinc-200"
              onClick={() => {
                updateFilter('category_id', undefined);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="listing-market" className="text-xs uppercase text-zinc-400">
          City
        </Label>
        <MarketSelector
          id="listing-market"
          value={selectedMarket?.slug ?? null}
          clearable
          onSelect={(m) => {
            setMarket(m);
            // Markets currently have null coords (geocode backfill pending), so
            // this is a no-op today — but wire the conditional so precise radius
            // filtering activates automatically once markets are geocoded.
            if (m && m.lat != null && m.lng != null) {
              const next: SearchListingsParams = {
                ...filters,
                page: 1,
                lat: m.lat,
                lng: m.lng,
                radius_km: filters.radius_km ?? 40,
              };
              onChange(next);
            }
          }}
        />
        <p className="text-xs text-zinc-500">
          Sets your city. Enter a zip for precise radius.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="listing-zip" className="text-xs uppercase text-zinc-400">
            Zip
          </Label>
          <Input
            id="listing-zip"
            variant="glass"
            inputMode="numeric"
            placeholder="94110"
            maxLength={10}
            value={filters.pickup_zip ?? ''}
            onChange={(e) => {
              updateFilter('pickup_zip', e.target.value || undefined);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="listing-radius" className="text-xs uppercase text-zinc-400">
            Radius (mi)
          </Label>
          <Input
            id="listing-radius"
            type="number"
            min={1}
            max={500}
            variant="glass"
            placeholder="25"
            value={filters.radius_km !== undefined ? Math.round(filters.radius_km * 0.621371) : ''}
            onChange={(e) => {
              const miles = Number(e.target.value);
              if (!Number.isFinite(miles) || miles <= 0) {
                updateFilter('radius_km', undefined);
              } else {
                updateFilter('radius_km', Math.round(miles / 0.621371));
              }
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="listing-min-price" className="text-xs uppercase text-zinc-400">
            Min $
          </Label>
          <Input
            id="listing-min-price"
            type="number"
            min={0}
            variant="glass"
            placeholder="0"
            value={
              filters.min_price_cents !== undefined ? Math.round(filters.min_price_cents / 100) : ''
            }
            onChange={(e) => {
              const dollars = Number(e.target.value);
              if (!Number.isFinite(dollars) || dollars <= 0) {
                updateFilter('min_price_cents', undefined);
              } else {
                updateFilter('min_price_cents', Math.round(dollars * 100));
              }
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="listing-max-price" className="text-xs uppercase text-zinc-400">
            Max $
          </Label>
          <Input
            id="listing-max-price"
            type="number"
            min={0}
            variant="glass"
            placeholder="2000"
            value={
              filters.max_price_cents !== undefined ? Math.round(filters.max_price_cents / 100) : ''
            }
            onChange={(e) => {
              const dollars = Number(e.target.value);
              if (!Number.isFinite(dollars) || dollars <= 0) {
                updateFilter('max_price_cents', undefined);
              } else {
                updateFilter('max_price_cents', Math.round(dollars * 100));
              }
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="listing-ending-soon"
          checked={filters.ending_soon === true}
          onCheckedChange={(c) => {
            updateFilter('ending_soon', c === true ? true : undefined);
          }}
        />
        <Label htmlFor="listing-ending-soon" className="cursor-pointer text-sm text-zinc-200">
          Ending soon (under 1h)
        </Label>
      </div>

      {hasAnyFilter ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] w-full border-white/10 text-zinc-300"
          onClick={() => {
            onChange({ page: 1, page_size: filters.page_size });
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

// Goods categories are now DB-driven (useGoodsCategoryTree → /categories/tree);
// the hardcoded array was removed. Export kept (empty) to preserve the module
// contract for any importer.
export const __TEST_GOODS_CATEGORIES: { id: string; name: string; slug: string }[] = [];
