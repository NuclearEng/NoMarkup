'use client';

import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCategoryTree } from '@/hooks/useCategories';
import type { SearchJobsParams, ServiceCategory } from '@/types';

interface JobSearchFiltersProps {
  filters: SearchJobsParams;
  onChange: (filters: SearchJobsParams) => void;
}

const DEBOUNCE_MS = 400;

function flattenCategories(categories: ServiceCategory[]): ServiceCategory[] {
  const result: ServiceCategory[] = [];
  function walk(cats: ServiceCategory[]) {
    for (const cat of cats) {
      result.push(cat);
      if (cat.children) walk(cat.children);
    }
  }
  walk(categories);
  return result;
}

export function JobSearchFilters({ filters, onChange }: JobSearchFiltersProps) {
  const { data: categoryTree } = useCategoryTree();
  const [searchText, setSearchText] = useState(filters.query ?? '');

  const flatCategories = categoryTree ? flattenCategories(categoryTree) : [];

  const updateFilters = useCallback(
    (partial: Partial<SearchJobsParams>) => {
      onChange({ ...filters, ...partial, page: 1 });
    },
    [filters, onChange],
  );

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText !== (filters.query ?? '')) {
        updateFilters({ query: searchText || undefined });
      }
    }, DEBOUNCE_MS);

    return () => { clearTimeout(timer); };
  }, [searchText, filters.query, updateFilters]);

  function handleReset() {
    setSearchText('');
    onChange({ page: 1, page_size: filters.page_size });
  }

  return (
    <div className="space-y-6">
      {/* Text search */}
      <div className="space-y-2">
        <Label htmlFor="job-search">Search</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="job-search"
            type="search"
            placeholder="Search jobs..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); }}
            className="min-h-[44px] pl-10"
          />
        </div>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label htmlFor="category-filter">Category</Label>
        <Select
          value={filters.category_id ?? 'all'}
          onValueChange={(value) => {
            updateFilters({ category_id: value === 'all' ? undefined : value });
          }}
        >
          <SelectTrigger id="category-filter" className="min-h-[44px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {flatCategories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.level > 0 ? `${'  '.repeat(cat.level)}${cat.name}` : cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule type */}
      <div className="space-y-2">
        <Label htmlFor="schedule-filter">Schedule Type</Label>
        <Select
          value={filters.schedule_type ?? 'all'}
          onValueChange={(value) => {
            updateFilters({
              schedule_type:
                value === 'all'
                  ? undefined
                  : (value as SearchJobsParams['schedule_type']),
            });
          }}
        >
          <SelectTrigger id="schedule-filter" className="min-h-[44px]">
            <SelectValue placeholder="Any Schedule" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Schedule</SelectItem>
            <SelectItem value="specific_date">Specific Date</SelectItem>
            <SelectItem value="date_range">Date Range</SelectItem>
            <SelectItem value="flexible">Flexible</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Price range */}
      <div className="space-y-2">
        <Label>Price Range</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Min $"
            min={0}
            value={filters.min_price_cents !== undefined ? String(filters.min_price_cents / 100) : ''}
            onChange={(e) => {
              const val = e.target.value ? Math.round(Number(e.target.value) * 100) : undefined;
              updateFilters({ min_price_cents: val });
            }}
            className="min-h-[44px]"
            aria-label="Minimum price in dollars"
          />
          <Input
            type="number"
            placeholder="Max $"
            min={0}
            value={filters.max_price_cents !== undefined ? String(filters.max_price_cents / 100) : ''}
            onChange={(e) => {
              const val = e.target.value ? Math.round(Number(e.target.value) * 100) : undefined;
              updateFilters({ max_price_cents: val });
            }}
            className="min-h-[44px]"
            aria-label="Maximum price in dollars"
          />
        </div>
      </div>

      {/* Location / Radius */}
      <div className="space-y-2">
        <Label htmlFor="location-filter">Location</Label>
        <Input
          id="location-filter"
          type="text"
          placeholder="City or zip code"
          className="min-h-[44px]"
          aria-label="Location filter"
        />
        <div className="space-y-2">
          <Label htmlFor="radius-filter">Radius (km)</Label>
          <Input
            id="radius-filter"
            type="number"
            placeholder="25"
            min={1}
            max={200}
            value={filters.radius_km !== undefined ? String(filters.radius_km) : ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              updateFilters({ radius_km: val });
            }}
            className="min-h-[44px]"
          />
        </div>
      </div>

      {/* Recurring toggle */}
      <div className="flex min-h-[44px] items-center gap-3">
        <Checkbox
          id="recurring-filter"
          checked={filters.is_recurring ?? false}
          onCheckedChange={(checked) => {
            updateFilters({ is_recurring: checked === true ? true : undefined });
          }}
        />
        <Label htmlFor="recurring-filter" className="cursor-pointer">
          Recurring jobs only
        </Label>
      </div>

      {/* Reset */}
      <Button
        type="button"
        variant="outline"
        onClick={handleReset}
        className="min-h-[44px] w-full"
      >
        Reset Filters
      </Button>
    </div>
  );
}
