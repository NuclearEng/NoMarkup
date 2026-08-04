'use client';

import { Gavel, Heart, Radio } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MonoPrice } from '@/components/ui/mono-price';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyBids } from '@/hooks/useBids';
import { useWatchlist } from '@/hooks/useWatchlist';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

/**
 * Active positions blotter — StockX multi-watch style: service bids I'm in +
 * goods I'm watching. Single desk for dual-rail market focus.
 */
export default function PositionsPage() {
  const user = useAuthStore((s) => s.user);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const myBids = useMyBids(undefined, 1);
  const watchlist = useWatchlist(1, { enabled: true });

  const bids = myBids.data?.bids ?? [];
  const watched = watchlist.data?.listings ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-zinc-100">
          Active positions
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Your open market exposure — service bids and watched goods auctions.
        </p>
      </div>

      {/* Service bids (provider) */}
      <section aria-labelledby="positions-bids-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="positions-bids-heading"
            className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-300 uppercase"
          >
            <Gavel className="h-4 w-4 text-brand-gold" aria-hidden="true" />
            My service bids
          </h2>
          <Button variant="outline" size="sm" className="min-h-[36px]" asChild>
            <Link href={'/bids' as Route}>All bids</Link>
          </Button>
        </div>

        {!isProvider ? (
          <EmptyState
            title="Provider bids only"
            description="Enable a provider role to place reverse-auction bids on jobs."
            action={
              <Button asChild className="min-h-[44px]">
                <Link href={'/provider/onboarding' as Route}>Become a provider</Link>
              </Button>
            }
          />
        ) : myBids.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : bids.length === 0 ? (
          <EmptyState
            title="No active bids"
            description="Browse open jobs and place a sealed or live bid."
            action={
              <Button asChild className="min-h-[44px]">
                <Link href={'/jobs' as Route}>Browse jobs</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {bids.slice(0, 12).map((b) => (
              <li key={b.id}>
                <Link
                  href={`/jobs/${b.job_id}` as Route}
                  className={cn(
                    'glass flex min-h-[56px] items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-4 py-3 transition-colors hover:border-brand-gold/30',
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      Job {b.job_id.slice(0, 8)}…
                    </p>
                    <p className="text-xs text-zinc-500">{b.status.replace(/_/g, ' ')}</p>
                  </div>
                  <MonoPrice
                    cents={b.amount_cents}
                    className="shrink-0 text-base font-semibold text-bid-winning"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Goods watchlist */}
      <section aria-labelledby="positions-watch-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="positions-watch-heading"
            className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-300 uppercase"
          >
            <Heart className="h-4 w-4 text-brand-gold" aria-hidden="true" />
            Watching (goods)
          </h2>
          <Button variant="outline" size="sm" className="min-h-[36px]" asChild>
            <Link href={'/me/watchlist' as Route}>Watchlist</Link>
          </Button>
        </div>

        {watchlist.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : watched.length === 0 ? (
          <EmptyState
            title="Nothing on watch"
            description="Heart listings on the marketplace to track them here."
            action={
              <Button asChild className="min-h-[44px]">
                <Link href={'/marketplace' as Route}>Marketplace</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {watched.slice(0, 12).map((l) => (
              <li key={l.id}>
                <Link
                  href={`/marketplace/${l.id}` as Route}
                  className="glass flex min-h-[56px] items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-4 py-3 transition-colors hover:border-brand-gold/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{l.title}</p>
                    <p className="flex items-center gap-1 text-xs text-zinc-500">
                      <Radio className="h-3 w-3" aria-hidden="true" />
                      {l.status.replace(/_/g, ' ')} · {String(l.bid_count)} bids
                    </p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block text-[10px] tracking-wide text-zinc-500 uppercase">
                      Current
                    </span>
                    <MonoPrice
                      cents={l.current_bid_cents}
                      className="text-base font-semibold text-brand-gold"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
