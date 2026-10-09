'use client';

import { Check, ChevronsUpDown, Clock, LocateFixed, MapPin, Navigation, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMarkets } from '@/hooks/useMarkets';
import { useRecentMarkets } from '@/hooks/useSelectedMarket';
import { cn } from '@/lib/utils';
import type { Market } from '@/types';

interface MarketSelectorProps {
  /** Currently selected market slug (controlled). */
  value?: string | null;
  /** Fired on pick. `null` when the user clears the selection. */
  onSelect: (market: Market | null) => void;
  /** Restrict the catalog to one country. Omit for all launched markets. */
  country?: 'US' | 'MX';
  /** Let the user clear back to "no market". Default true. */
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  /** Render a compact, chip-style trigger (for the header). */
  compact?: boolean;
  id?: string;
}

const NEARBY_COUNT = 6;

// Title-case craigslist's lowercase market names ("seattle-tacoma" →
// "Seattle-Tacoma"), capitalizing after spaces/hyphens/slashes while leaving
// existing acronyms (e.g. "SJI") untouched.
function formatName(name: string): string {
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function regionOf(m: Market): string {
  if (m.country === 'MX') return 'Mexico';
  return m.region ?? 'Other';
}

// Haversine distance in km between two lat/lng points.
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestMarket(lat: number, lng: number, markets: Market[]): Market | null {
  let best: Market | null = null;
  let bestD = Infinity;
  for (const m of markets) {
    if (m.lat == null || m.lng == null) continue;
    const d = distanceKm(lat, lng, m.lat, m.lng);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/**
 * MarketSelector — best-in-class city/market picker.
 *
 * Only LAUNCHED markets surface (the public /markets endpoint is active-gated;
 * rollout is admin-controlled). Front door is detection + shortcuts, not a raw
 * list: "Use my location" (geolocation → nearest launched market), Recent picks,
 * and Nearby markets, with type-to-search and a grouped browse list as the
 * fallback. Full keyboard nav over the list (arrows/Enter/Esc), WCAG 2.2 AA.
 */
export function MarketSelector({
  value,
  onSelect,
  country,
  clearable = true,
  placeholder = 'Choose a city',
  className,
  compact = false,
  id,
}: MarketSelectorProps) {
  const { data: markets, isLoading } = useMarkets({ country });
  const [recents, pushRecent] = useRecentMarkets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Only ever surface LAUNCHED markets. The public endpoint is already
  // active-gated; this client-side filter is defense-in-depth so a stray
  // inactive market can never leak into the list, recents, or nearby.
  const all = useMemo(() => (markets ?? []).filter((m) => m.is_active), [markets]);
  const selected = useMemo(() => all.find((m) => m.slug === value) ?? null, [all, value]);

  // Recents, filtered to markets that are still launched (a city pulled back by
  // an admin drops out of the shortcut automatically).
  const liveRecents = useMemo(() => {
    const live = new Set(all.map((m) => m.slug));
    return recents.filter((r) => live.has(r.slug)).slice(0, 4);
  }, [recents, all]);

  // Nearby = closest launched markets to the current selection (excluding it).
  const nearby = useMemo(() => {
    if (!selected || selected.lat == null || selected.lng == null) return [];
    return all
      .filter((m) => m.slug !== selected.slug && m.lat != null && m.lng != null)
      .map((m) => ({ m, d: distanceKm(selected.lat as number, selected.lng as number, m.lat as number, m.lng as number) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEARBY_COUNT)
      .map((x) => x.m);
  }, [all, selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (m) =>
        formatName(m.name).toLowerCase().includes(q) ||
        regionOf(m).toLowerCase().includes(q) ||
        m.region_code?.toLowerCase() === q,
    );
  }, [all, search]);

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

  useEffect(() => { setActiveIndex(0); }, [search]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => { clearTimeout(t); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${String(activeIndex)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function choose(m: Market) {
    onSelect(m);
    pushRecent(m);
    setOpen(false);
    setSearch('');
    setLocateError(null);
  }

  function useMyLocation() {
    setLocateError(null);
    if (!('geolocation' in navigator)) {
      setLocateError('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const near = nearestMarket(pos.coords.latitude, pos.coords.longitude, all);
        if (near) choose(near);
        else setLocateError('No launched markets near you yet.');
      },
      () => {
        setLocating(false);
        setLocateError("Couldn't get your location. Pick a city below.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
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
    ? `${formatName(selected.name)}${selected.region_code ? `, ${selected.region_code}` : ''}`
    : placeholder;

  let flatIndex = -1;

  function shortcut(m: Market, key: string, icon: React.ReactNode) {
    return (
      <button
        key={key}
        type="button"
        onClick={() => { choose(m); }}
        className="flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
      >
        {icon}
        <span className="truncate">{formatName(m.name)}</span>
      </button>
    );
  }

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
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[280px] max-w-[calc(100vw-2rem)] p-0"
        align="start"
      >
        {/* Use my location — the primary path. ASR-5.1.5 purpose string. */}
        <div className="border-b p-2">
          <Button
            type="button"
            className="min-h-[44px] w-full justify-start gap-2 bg-primary font-medium text-primary-foreground hover:bg-primary/90"
            onClick={useMyLocation}
            disabled={locating}
          >
            <LocateFixed className={cn('h-4 w-4', locating && 'animate-pulse')} aria-hidden="true" />
            {locating ? 'Locating…' : 'Use my location'}
          </Button>
          <p className="mt-1.5 px-1 text-xs text-muted-foreground">
            Used to find your nearest NoMarkup market. You can pick a city instead.
          </p>
          {locateError ? (
            <p className="mt-1 px-1 text-xs text-destructive" role="alert">{locateError}</p>
          ) : null}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          <Input
            ref={searchRef}
            type="search"
            placeholder="Search cities…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            onKeyDown={handleKeyDown}
            className="h-11 border-0 px-0 shadow-none focus-visible:ring-0"
            role="combobox"
            aria-expanded={open}
            aria-controls="market-listbox"
            aria-activedescendant={filtered[activeIndex] ? `market-opt-${String(activeIndex)}` : undefined}
            aria-label="Search cities"
          />
        </div>

        {/* Shortcuts (only when not searching) */}
        {!search && (liveRecents.length > 0 || nearby.length > 0) ? (
          <div className="space-y-2 border-b p-2">
            {liveRecents.length > 0 ? (
              <div>
                <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Recent</p>
                <div className="flex flex-wrap gap-1.5">
                  {liveRecents.map((m) => shortcut(m, `r-${m.slug}`, <Clock className="h-3 w-3 opacity-60" aria-hidden="true" />))}
                </div>
              </div>
            ) : null}
            {nearby.length > 0 ? (
              <div>
                <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                  Near {formatName(selected?.name ?? '')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {nearby.map((m) => shortcut(m, `n-${m.slug}`, <Navigation className="h-3 w-3 opacity-60" aria-hidden="true" />))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Browse list */}
        <ul
          ref={listRef}
          id="market-listbox"
          role="listbox"
          aria-label="Cities"
          className="max-h-[280px] overflow-y-auto py-1"
        >
          {isLoading ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Loading cities…</li>
          ) : groups.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {search ? `No cities match “${search}”.` : 'No markets are live yet.'}
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
                            'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                            isActiveOpt && 'bg-accent text-accent-foreground',
                            isSelected && 'font-medium text-primary',
                          )}
                        >
                          <Check
                            className={cn(
                              'h-4 w-4 shrink-0 text-primary',
                              isSelected ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{formatName(m.name)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        {/* Coming-soon note + clear */}
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          More cities coming soon — we&apos;re expanding market by market.
        </div>
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
