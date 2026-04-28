'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SearchListingsParams } from '@/types';

const GOODS_CATEGORIES: { id: string; name: string; slug: string }[] = [
  { id: 'goods-furniture', name: 'Furniture', slug: 'furniture' },
  { id: 'goods-electronics', name: 'Electronics', slug: 'electronics' },
  { id: 'goods-tools', name: 'Tools', slug: 'tools' },
  { id: 'goods-sporting', name: 'Sporting Goods', slug: 'sporting-goods' },
  { id: 'goods-vehicles', name: 'Vehicles', slug: 'vehicles' },
  { id: 'goods-home-garden', name: 'Home & Garden', slug: 'home-garden' },
  { id: 'goods-baby-kids', name: 'Baby & Kids', slug: 'baby-kids' },
  { id: 'goods-collectibles', name: 'Collectibles', slug: 'collectibles' },
];

interface ListingFiltersProps {
  filters: SearchListingsParams;
  onChange: (next: SearchListingsParams) => void;
}

export function ListingFilters({ filters, onChange }: ListingFiltersProps) {
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
        <Select
          value={filters.category_id ?? 'all'}
          onValueChange={(value) => {
            updateFilter('category_id', value === 'all' ? undefined : value);
          }}
        >
          <SelectTrigger id="listing-category" className="min-h-[44px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {GOODS_CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

export const __TEST_GOODS_CATEGORIES = GOODS_CATEGORIES;
