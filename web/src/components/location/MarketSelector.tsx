'use client';

import { Check, ChevronsUpDown, MapPin, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMarkets } from '@/hooks/useMarkets';
import { cn } from '@/lib/utils';
import type { Market } from '@/types';

interface MarketSelectorProps {
  /** Currently selected market slug (controlled). */
  value?: string | null;
  /** Fired on pick. `null` when the user clears the selection. */
  onSelect: (market: Market | null) => void;
  /** Restrict the catalog to one country. Omit for US + MX. */
  country?: 'US' | 'MX';
  /** Show only launched markets. Default false → full catalog with badges. */
  activeOnly?: boolean;
  /** Let the user clear back to "no market". Default true. */
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  /** Render a compact, chip-style trigger (for the header). */
  compact?: boolean;
  id?: string;
}

function regionOf(m: Market): string {
  if (m.country === 'MX') return 'Mexico';
  return m.region ?? 'Other';
}

/**
 * MarketSelector — searchable, keyboard-navigable city/market picker.
 *
 * Why a custom combobox instead of <Select>: 432 markets across 50 states is far
 * too many for a flat native select. This gives type-to-filter, grouped-by-state
 * sections, full arrow-key/Enter/Escape navigation, and aria-activedescendant —
 * WCAG 2.2 AA. Unlaunched markets show a "Soon" badge but stay selectable so a
 * visitor can pick their city before we go live there (craigslist-style).
 */
export function MarketSelector({
  value,
  onSelect,
  country,
  activeOnly = false,
  clearable = true,
  placeholder = 'Choose a city',
  className,
  compact = false,
  id,
}: MarketSelectorProps) {
  const { data: markets, isLoading } = useMarkets({ country, activeOnly });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => markets?.find((m) => m.slug === value) ?? null,
    [markets, value],
  );

  // Flat, filtered, region-sorted list. Active markets float to the top of each
  // region (the API already sorts is_active DESC, region, name).
  const filtered = useMemo(() => {
    if (!markets) return [];
    const q = search.trim().toLowerCase();
    if (!q) return markets;
    return markets.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        regionOf(m).toLowerCase().includes(q) ||
        (m.region_code?.toLowerCase() === q),
    );
  }, [markets, search]);

  // Group filtered markets by region, preserving the API's sort order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byRegion = new Map<string, Market[]>();
    for (const m of filtered) {
      const r = regionOf(m);
      if (!byRegion.has(r)) {
        byRegion.set(r, []);
        order.push(r);
      }
      byRegion.get(r)?.push(m);
    }
    return order.map((r) => ({ region: r, markets: byRegion.get(r) ?? [] }));
  }, [filtered]);

  // Keep activeIndex in range as the filter changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  // Focus the search box when the popover opens (a11y-approved alternative to
  // the autoFocus prop). A short timeout lets Radix mount the content first.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => { clearTimeout(t); };
  }, [open]);

  // Scroll the active option into view on keyboard nav.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${String(activeIndex)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function choose(m: Market) {
    onSelect(m);
    setOpen(false);
    setSearch('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = filtered[activeIndex];
      if (m) choose(m);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const triggerLabel = selected
    ? `${selected.name}${selected.region_code ? `, ${selected.region_code}` : ''}`
    : placeholder;

  // Stable per-render flat index so aria-activedescendant + click share IDs.
  let flatIndex = -1;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select a city or market"
          className={cn(
            'min-h-[44px] justify-between gap-2 font-normal',
            compact && 'h-9 min-h-0 px-3',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <MapPin className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[260px] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          <Input
            ref={searchRef}
            type="search"
            placeholder="Search 432 cities…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            onKeyDown={handleKeyDown}
            className="h-11 border-0 px-0 shadow-none focus-visible:ring-0"
            role="combobox"
            aria-expanded={open}
            aria-controls="market-listbox"
            aria-activedescendant={
              filtered[activeIndex] ? `market-opt-${String(activeIndex)}` : undefined
            }
            aria-label="Search cities"
          />
        </div>

        <ul
          ref={listRef}
          id="market-listbox"
          role="listbox"
          aria-label="Cities"
          className="max-h-[320px] overflow-y-auto py-1"
        >
          {isLoading ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Loading cities…</li>
          ) : groups.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No cities match “{search}”.
            </li>
          ) : (
            groups.map((group) => (
              <li key={group.region} role="presentation">
                <div className="sticky top-0 z-10 bg-popover px-3 py-1 text-xs font-medium text-muted-foreground">
                  {group.region}
                </div>
                <ul role="presentation">
                  {group.markets.map((m) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const isActiveOpt = idx === activeIndex;
                    const isSelected = m.slug === value;
                    return (
                      <li key={m.slug} role="presentation">
                        <button
                          type="button"
                          id={`market-opt-${String(idx)}`}
                          data-index={idx}
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => { setActiveIndex(idx); }}
                          onClick={() => { choose(m); }}
                          className={cn(
                            'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm',
                            isActiveOpt && 'bg-accent text-accent-foreground',
                          )}
                        >
                          <Check
                            className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                            aria-hidden="true"
                          />
                          <span className="truncate">{m.name}</span>
                          {!m.is_active ? (
                            <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                              Soon
                            </Badge>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        {clearable && selected ? (
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] w-full justify-start text-sm text-muted-foreground"
              onClick={() => {
                onSelect(null);
                setOpen(false);
                setSearch('');
              }}
            >
              Clear selection
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
