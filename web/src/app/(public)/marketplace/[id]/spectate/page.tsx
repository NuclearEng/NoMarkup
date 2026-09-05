'use client';

import { ArrowLeft, MapPin, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';

import { GradientMesh } from '@/components/landing/GradientMesh';
import { TerminalGrid } from '@/components/terminal/terminal-grid';
import { TerminalToolbar } from '@/components/terminal/terminal-toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarketplaceSpectatorTerminal } from '@/hooks/useMarketplaceSpectatorTerminal';
import type { MarketRange } from '@/types';

const EMPTY_MARKET: MarketRange = {
  low_cents: 0,
  median_cents: 0,
  high_cents: 0,
  sample_size: 0,
};

/**
 * Goods marketplace full-spectate terminal.
 * Mounts TerminalGrid with ascending-auction data (high = "currentLowest" alias).
 */
export default function ListingSpectatePage() {
  const params = useParams<{ id: string }>();
  const listingId = params.id;

  const terminal = useMarketplaceSpectatorTerminal(listingId);

  const auctionEndsAt = useMemo(
    () =>
      terminal.auctionEndsAt ??
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    [terminal.auctionEndsAt],
  );

  if (terminal.isLoading) {
    return (
      <div className="dark relative min-h-screen overflow-y-auto bg-background text-zinc-100">
        <GradientMesh />
        <div
          className="mx-auto max-w-3xl space-y-4 px-4 py-12 sm:px-6"
          role="status"
          aria-label="Loading auction"
        >
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (terminal.isError && !terminal.jobTitle) {
    return (
      <div className="dark relative min-h-screen overflow-y-auto bg-background text-zinc-100">
        <GradientMesh />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <EmptyState
            title="Failed to load listing"
            description="We could not load this auction. Check your connection and try again."
            action={
              <Button type="button" className="min-h-11" asChild>
                <Link href={`/marketplace/${listingId}` as Route}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  Back to listing
                </Link>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const connectionLabel = terminal.isConnected
    ? 'LIVE'
    : 'OFFLINE';

  return (
    <div className="dark relative min-h-screen overflow-y-auto bg-background text-zinc-100">
      <GradientMesh />
      <div
        className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />

      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/marketplace/${listingId}` as Route}
              className="flex min-h-11 items-center gap-1.5 text-sm text-white/65 hover:text-white/85"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Listing</span>
            </Link>
            <div className="h-4 w-px bg-white/10" />
            <Badge className="gap-1 border-white/10 bg-white/5 text-xs text-white/70">
              <Radio className="h-3 w-3" aria-hidden="true" />
              SPECTATE
            </Badge>
            <Badge
              className={
                terminal.isConnected
                  ? 'gap-1 border-red-500/20 bg-red-500/10 text-xs text-red-400'
                  : 'gap-1 border-white/10 bg-white/5 text-xs text-white/50'
              }
              aria-live="polite"
            >
              {terminal.isConnected ? (
                <Wifi className="h-3 w-3 animate-pulse" aria-hidden="true" />
              ) : (
                <WifiOff className="h-3 w-3" aria-hidden="true" />
              )}
              {connectionLabel}
            </Badge>
            {terminal.isConnected && terminal.spectatorCount > 0 ? (
              <span className="hidden text-xs text-white/45 sm:inline">
                {String(terminal.spectatorCount)} watching
              </span>
            ) : null}
          </div>
          <div className="hidden items-center gap-3 text-sm md:flex">
            <h1 className="font-semibold text-white/90">{terminal.jobTitle}</h1>
            {terminal.jobCategory ? (
              <div className="flex items-center gap-2 text-white/60">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{terminal.jobCategory}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="relative z-[2] mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
        <TerminalToolbar />
      </div>

      <div className="relative z-[2] mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
        <TerminalGrid
          sim={terminal.sim}
          auctionEndsAt={auctionEndsAt}
          startingPriceCents={terminal.startingPriceCents}
          marketRange={EMPTY_MARKET}
          mockProviders={terminal.providers}
          jobId={listingId}
          snipeExtensionCount={terminal.snipeExtensionCount}
          jobTitle={terminal.jobTitle}
          jobDescription={terminal.jobDescription}
          jobCategory={terminal.jobCategory}
        />
      </div>

      <p className="relative z-[2] mx-auto max-w-[1400px] px-4 pb-8 text-[11px] text-zinc-500 sm:px-6">
        Goods are forward auctions — the big price is the current high bid. Remove
        reverse-only widgets (Savings, Market Intel) in edit mode if they appear.
      </p>
    </div>
  );
}
