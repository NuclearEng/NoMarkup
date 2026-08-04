'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Eye, MapPin, Radio, Wifi, WifiOff, Zap } from 'lucide-react';

import { GradientMesh } from '@/components/landing/GradientMesh';
import { TerminalToolbar } from '@/components/terminal/terminal-toolbar';
import { TerminalGrid } from '@/components/terminal/terminal-grid';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useJob } from '@/hooks/useJobs';
import { useSpectatorTerminal } from '@/hooks/useSpectatorTerminal';
import { useTerminalHotkeys } from '@/hooks/useTerminalHotkeys';
import type { MarketRange } from '@/types';

const FALLBACK_MARKET_RANGE: MarketRange = {
  low_cents: 0,
  median_cents: 0,
  high_cents: 0,
  sample_size: 0,
};

export default function SpectatorPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const { data: job, isLoading, isError } = useJob(jobId);
  const { sim, providers, spectatorCount, isConnected, error } = useSpectatorTerminal(jobId);

  const auctionEndsAt = useMemo(
    () => job?.auction_ends_at ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    [job?.auction_ends_at],
  );

  const startingPriceCents = job?.starting_bid_cents ?? 0;
  const marketRange = job?.market_range ?? FALLBACK_MARKET_RANGE;

  useTerminalHotkeys({ enabled: !isLoading && !isError && !!job, mode: 'spectate' });

  if (isLoading) {
    return (
      <div className="dark relative min-h-screen overflow-y-auto bg-background">
        <GradientMesh />
        <div
          className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
          aria-hidden="true"
        />
        <div className="relative z-[2] flex min-h-screen items-center justify-center">
          <div
            className="mx-auto w-full max-w-2xl space-y-6 px-4 text-center"
            role="status"
            aria-label="Loading auction"
          >
            <Skeleton className="mx-auto h-8 w-2/3 max-w-xs" />
            <Skeleton className="mx-auto h-4 w-1/3 max-w-[140px]" />
            <Skeleton
              variant="card"
              className="mx-auto h-96 w-full border border-white/[0.06]"
            />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="dark relative min-h-screen overflow-y-auto bg-background">
        <GradientMesh />
        <div
          className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
          aria-hidden="true"
        />
        <div className="relative z-[2] flex min-h-screen items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">Auction Not Found</h1>
            <p className="mt-2 text-white/65">
              This auction could not be found. It may have ended or been removed.
            </p>
            <Link
              href="/jobs"
              className="mt-4 inline-block text-sm font-medium text-amber-400 hover:text-amber-300 hover:underline"
            >
              Browse all jobs
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dark relative min-h-screen overflow-y-auto bg-background">
      {/* Animated gradient mesh */}
      <GradientMesh />

      {/* Cinematic vignette */}
      <div
        className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />

      {/* Sticky top bar */}
      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/jobs/${jobId}`}
              className="flex items-center gap-1.5 text-sm text-white/65 transition-colors hover:text-white/80"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div className="h-4 w-px bg-white/10" />
            <Badge className="gap-1 border-white/10 bg-white/5 text-xs text-white/70">
              <Radio className="h-3 w-3" aria-hidden="true" />
              SPECTATE
            </Badge>
            {/* LIVE only when the spectator socket is open — never claim live without connection (FE-06). */}
            <Badge
              className={
                isConnected
                  ? 'gap-1 border-red-500/20 bg-red-500/10 text-xs text-red-400'
                  : error
                    ? 'gap-1 border-red-500/20 bg-red-500/10 text-xs text-red-400'
                    : 'gap-1 border-amber-500/20 bg-amber-500/10 text-xs text-amber-300'
              }
              aria-live="polite"
            >
              {isConnected ? (
                <Wifi className="h-3 w-3 animate-pulse" aria-hidden="true" />
              ) : (
                <WifiOff className="h-3 w-3" aria-hidden="true" />
              )}
              {isConnected ? 'LIVE' : error ? 'OFFLINE' : 'CONNECTING'}
            </Badge>
          </div>

          {/* Job info */}
          <div className="hidden items-center gap-3 text-sm md:flex">
            <h1 className="font-semibold text-white/90">{job.title}</h1>
            {job.location_address && (
              <div className="flex items-center gap-2 text-white/60">
                <MapPin className="h-3.5 w-3.5" />
                <span>{job.location_address}</span>
              </div>
            )}
          </div>

          {/* Right side: connection status + spectator count */}
          <div className="flex items-center gap-3">
            {spectatorCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-white/60">
                <Eye className="h-3.5 w-3.5" />
                <span>{spectatorCount} watching</span>
              </div>
            )}
            <div
              className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs ${
                isConnected
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : error
                    ? 'border-red-500/20 bg-red-500/10 text-red-400'
                    : 'border-white/10 bg-white/5 text-white/65'
              }`}
              role="status"
              aria-label={
                isConnected
                  ? 'Connected to live stream'
                  : error
                    ? 'Connection error'
                    : 'Connecting to live stream'
              }
            >
              {isConnected ? (
                <>
                  <Wifi className="h-3 w-3" />
                  <span className="hidden sm:inline">Spectating</span>
                </>
              ) : error ? (
                <>
                  <WifiOff className="h-3 w-3" />
                  <span className="hidden sm:inline">Disconnected</span>
                </>
              ) : (
                <>
                  <Zap className="h-3 w-3 animate-pulse" />
                  <span className="hidden sm:inline">Connecting</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile job info row */}
        <div className="border-t border-white/[0.04] px-4 py-1.5 md:hidden">
          <p className="truncate text-xs font-medium text-white/70">{job.title}</p>
          {job.location_address && (
            <p className="flex items-center gap-1 text-[10px] text-white/40">
              <MapPin className="h-2.5 w-2.5" />
              {job.location_address}
            </p>
          )}
        </div>
      </div>

      {/* Terminal toolbar */}
      <div className="relative z-[2] mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
        <TerminalToolbar />
      </div>

      {/* Terminal grid */}
      <div className="relative z-[2] mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
        <TerminalGrid
          sim={sim}
          auctionEndsAt={auctionEndsAt}
          startingPriceCents={startingPriceCents}
          marketRange={marketRange}
          mockProviders={providers}
          jobId={jobId}
          snipeExtensionCount={job.snipe_extension_count ?? 0}
          jobTitle={job.title}
          jobDescription={job.description}
          jobCategory={job.category_name}
        />
      </div>
    </div>
  );
}
