'use client';

import { useMemo, useState } from 'react';

import { toast } from 'sonner';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type SetMarketsActiveInput,
  useAdminMarkets,
  useSetMarketsActive,
} from '@/hooks/useAdmin';
import { getApiErrorMessage } from '@/lib/api';
import type { Market } from '@/types';

const COUNTRY_LABEL: Record<Market['country'], string> = {
  US: 'United States',
  MX: 'Mexico',
};

// A pending confirmation: which markets to (de)activate, the selector to send,
// and a human label for the dialog copy.
interface PendingAction {
  input: SetMarketsActiveInput;
  count: number;
  scopeLabel: string;
}

interface RegionGroup {
  // Stable key — region_code when present, else the region name, else a fallback.
  key: string;
  region: string;
  regionCode: string | null;
  markets: Market[];
  liveCount: number;
}

interface CountryGroup {
  country: Market['country'];
  regions: RegionGroup[];
  total: number;
  liveCount: number;
}

function groupMarkets(markets: Market[]): CountryGroup[] {
  const byCountry = new Map<Market['country'], Map<string, RegionGroup>>();

  for (const m of markets) {
    let regions = byCountry.get(m.country);
    if (!regions) {
      regions = new Map<string, RegionGroup>();
      byCountry.set(m.country, regions);
    }
    const region = m.region ?? 'Other';
    const key = m.region_code ?? region;
    let group = regions.get(key);
    if (!group) {
      group = { key, region, regionCode: m.region_code, markets: [], liveCount: 0 };
      regions.set(key, group);
    }
    group.markets.push(m);
  }

  const countries: CountryGroup[] = [];
  for (const [country, regions] of byCountry) {
    const regionGroups = [...regions.values()].map((g) => {
      g.markets.sort((a, b) => a.name.localeCompare(b.name));
      g.liveCount = g.markets.filter((m) => m.is_active).length;
      return g;
    });
    regionGroups.sort((a, b) => a.region.localeCompare(b.region));

    const total = regionGroups.reduce((sum, g) => sum + g.markets.length, 0);
    const liveCount = regionGroups.reduce((sum, g) => sum + g.liveCount, 0);
    countries.push({ country, regions: regionGroups, total, liveCount });
  }

  // US first, then MX (alphabetical fallback for any future countries).
  countries.sort((a, b) => a.country.localeCompare(b.country));
  return countries;
}

export default function AdminMarketsPage() {
  const { data, isLoading, isError } = useAdminMarkets();
  const setActive = useSetMarketsActive();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const markets = useMemo(() => data?.markets ?? [], [data]);
  const groups = useMemo(() => groupMarkets(markets), [markets]);

  const totalCount = markets.length;
  const liveCount = markets.filter((m) => m.is_active).length;

  async function handleConfirm() {
    if (!pending) return;
    try {
      const res = await setActive.mutateAsync(pending.input);
      toast.success(
        `${pending.input.active ? 'Launched' : 'Pulled back'} ${String(res.updated)} ${
          res.updated === 1 ? 'market' : 'markets'
        } in ${pending.scopeLabel}`,
      );
      setPending(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update markets'));
    }
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="gold-text text-2xl font-bold tracking-tight">Markets</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load markets"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-8">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Markets</h1>
          <p className="mt-1 text-zinc-300">
            Launch or pull back cities. Launching makes a market publicly browseable
            immediately.
          </p>
          {!isLoading ? (
            <p className="mt-2 text-sm font-medium text-emerald-400">
              {liveCount} of {totalCount} markets live
            </p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : totalCount === 0 ? (
          <EmptyState
            icon={<AnimatedIllustration type="search-empty" size="sm" />}
            title="No markets in the catalog"
            description="Markets are seeded by migration. None found."
          />
        ) : (
          <div className="space-y-10">
            {groups.map((country) => (
              <section key={country.country} className="space-y-5" aria-label={COUNTRY_LABEL[country.country]}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold">{COUNTRY_LABEL[country.country]}</h2>
                    <Badge variant="secondary" className="text-xs">
                      {country.liveCount} / {country.total} live
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      disabled={setActive.isPending || country.liveCount === country.total}
                      onClick={() => {
                        setPending({
                          input: { country: country.country, active: true },
                          count: country.total,
                          scopeLabel: COUNTRY_LABEL[country.country],
                        });
                      }}
                    >
                      Launch all
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      disabled={setActive.isPending || country.liveCount === 0}
                      onClick={() => {
                        setPending({
                          input: { country: country.country, active: false },
                          count: country.total,
                          scopeLabel: COUNTRY_LABEL[country.country],
                        });
                      }}
                    >
                      Pull back all
                    </Button>
                  </div>
                </div>

                {country.regions.map((region) => (
                  <div
                    key={region.key}
                    className="rounded-lg border border-border bg-card/40 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold">{region.region}</h3>
                        <Badge variant="secondary" className="text-xs">
                          {region.liveCount} / {region.markets.length} live
                        </Badge>
                      </div>
                      {region.regionCode ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px]"
                            disabled={
                              setActive.isPending ||
                              region.liveCount === region.markets.length
                            }
                            onClick={() => {
                              setPending({
                                input: {
                                  region_code: region.regionCode ?? undefined,
                                  active: true,
                                },
                                count: region.markets.length,
                                scopeLabel: region.region,
                              });
                            }}
                          >
                            Launch all
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px]"
                            disabled={setActive.isPending || region.liveCount === 0}
                            onClick={() => {
                              setPending({
                                input: {
                                  region_code: region.regionCode ?? undefined,
                                  active: false,
                                },
                                count: region.markets.length,
                                scopeLabel: region.region,
                              });
                            }}
                          >
                            Pull back all
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {region.markets.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">{m.name}</span>
                            {m.is_active ? (
                              <Badge variant="active" className="shrink-0 text-xs">
                                Live
                              </Badge>
                            ) : (
                              <Badge variant="draft" className="shrink-0 text-xs">
                                Not live
                              </Badge>
                            )}
                          </div>
                          <Button
                            variant={m.is_active ? 'outline' : 'default'}
                            size="sm"
                            className="min-h-[44px] shrink-0"
                            disabled={setActive.isPending}
                            onClick={() => {
                              setPending({
                                input: { slugs: [m.slug], active: !m.is_active },
                                count: 1,
                                scopeLabel: m.name,
                              });
                            }}
                          >
                            {m.is_active ? 'Pull back' : 'Launch'}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        <ActionConfirmDialog
          open={pending !== null}
          onClose={() => {
            setPending(null);
          }}
          onConfirm={() => {
            void handleConfirm();
          }}
          title={
            pending?.input.active
              ? `Launch ${pending.count === 1 ? '' : `all ${String(pending.count)} markets in `}${pending.scopeLabel}?`
              : `Pull back ${pending && pending.count === 1 ? '' : `all ${String(pending?.count ?? 0)} markets in `}${pending?.scopeLabel ?? ''}?`
          }
          description={
            pending?.input.active
              ? 'This makes them publicly browseable immediately.'
              : 'This removes them from the public market selector immediately. Existing listings are not deleted.'
          }
          confirmLabel={pending?.input.active ? 'Launch' : 'Pull back'}
          destructive={pending ? !pending.input.active : false}
          loading={setActive.isPending}
        />
      </div>
    </PageTransition>
  );
}
