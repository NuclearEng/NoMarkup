'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowLeft,
  ChevronRight,
  FastForward,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Trophy,
} from 'lucide-react';

import { GradientMesh } from '@/components/landing/GradientMesh';
import { TerminalToolbar } from '@/components/terminal/terminal-toolbar';
import { TerminalGrid } from '@/components/terminal/terminal-grid';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { useReplayTerminal, SPEED_OPTIONS, type SpeedOption } from '@/hooks/useReplayTerminal';
import { useTerminalHotkeys } from '@/hooks/useTerminalHotkeys';
import { formatCents } from '@/lib/utils';
import type { MarketRange } from '@/types';

// ── Loading skeleton ────────────────────────────────────────────────────────

function ReplayLoadingSkeleton() {
  return (
    <div className="dark relative min-h-screen overflow-y-auto bg-background">
      <GradientMesh />
      <div
        className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />
      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 sm:px-6">
          <Skeleton className="h-6 w-24 bg-white/10" />
          <Skeleton className="h-6 w-64 bg-white/10" />
          <Skeleton className="h-8 w-32 bg-white/10" />
        </div>
      </div>
      <div className="relative z-[2] mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
        <Skeleton className="h-10 w-full bg-white/5" />
      </div>
      <div className="relative z-[2] mx-auto max-w-[1400px] space-y-3 px-4 py-4 sm:px-6">
        <div className="grid grid-cols-12 gap-3">
          <Skeleton className="col-span-4 h-64 rounded-2xl bg-white/5" />
          <Skeleton className="col-span-4 h-64 rounded-2xl bg-white/5" />
          <Skeleton className="col-span-4 h-64 rounded-2xl bg-white/5" />
        </div>
        <div className="grid grid-cols-12 gap-3">
          <Skeleton className="col-span-6 h-48 rounded-2xl bg-white/5" />
          <Skeleton className="col-span-6 h-48 rounded-2xl bg-white/5" />
        </div>
      </div>
    </div>
  );
}

// ── Error state ─────────────────────────────────────────────────────────────

function ReplayNotFound() {
  return (
    <div className="dark relative flex min-h-screen flex-col items-center justify-center overflow-y-auto bg-background">
      <GradientMesh />
      <div
        className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />
      <div className="relative z-[2] text-center">
        <h1 className="text-2xl font-bold text-white">Replay Not Available</h1>
        <p className="mt-2 text-sm text-white/65">
          This auction replay could not be found. It may not have completed yet or the data is
          unavailable.
        </p>
        <Link
          href={'/jobs' as Route}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-amber-400 transition-colors hover:text-amber-300"
        >
          Browse all jobs
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

// ── Completion overlay ──────────────────────────────────────────────────────

interface CompletionOverlayProps {
  winningBidCents: number;
  totalBidCount: number;
  totalSavingsCents: number;
  startingBidCents: number;
  onReplay: () => void;
  onDismiss: () => void;
}

function CompletionOverlay({
  winningBidCents,
  totalBidCount,
  totalSavingsCents,
  startingBidCents,
  onReplay,
  onDismiss,
}: CompletionOverlayProps) {
  const savingsPercent =
    startingBidCents > 0 ? Math.round((totalSavingsCents / startingBidCents) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Auction replay complete"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-card p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
            <Trophy className="h-8 w-8 text-emerald-400" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Auction Complete</h2>
          <p className="mt-1 text-sm text-white/65">
            The reverse auction has concluded. Here are the final results.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-[10px] font-medium tracking-wider text-white/60 uppercase">
              Winning Bid
            </p>
            <p className="mt-1 text-lg font-bold text-emerald-400">
              {winningBidCents > 0 ? formatCents(winningBidCents) : 'N/A'}
            </p>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-[10px] font-medium tracking-wider text-white/60 uppercase">
              Total Bids
            </p>
            <p className="mt-1 text-lg font-bold text-white">{String(totalBidCount)}</p>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-[10px] font-medium tracking-wider text-white/60 uppercase">Saved</p>
            <p className="mt-1 text-lg font-bold text-emerald-400">
              {totalSavingsCents > 0 ? formatCents(totalSavingsCents) : '$0'}
            </p>
          </div>
        </div>

        {savingsPercent > 0 && (
          <div className="mt-4 rounded-lg bg-emerald-500/10 px-4 py-2 text-center">
            <span className="text-sm font-bold text-emerald-400">
              {String(savingsPercent)}% below starting price
            </span>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onReplay}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            Watch Again
          </button>
          <button
            onClick={onDismiss}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/15 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function AuctionReplayPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const replay = useReplayTerminal(jobId);
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  // Reset overlay dismissal when replay restarts (isComplete goes false)
  useEffect(() => {
    if (!replay.isComplete) {
      setOverlayDismissed(false);
    }
  }, [replay.isComplete]);

  // Compute market range from replay data for TerminalGrid
  const marketRange: MarketRange = useMemo(() => {
    if (replay.startingBidCents <= 0) {
      return { low_cents: 0, median_cents: 0, high_cents: 0, sample_size: 0 };
    }
    return {
      low_cents:
        replay.winningBidCents > 0
          ? replay.winningBidCents
          : Math.round(replay.startingBidCents * 0.6),
      median_cents: Math.round(replay.startingBidCents * 0.8),
      high_cents: replay.startingBidCents,
      sample_size: replay.totalBidCount,
    };
  }, [replay.startingBidCents, replay.winningBidCents, replay.totalBidCount]);

  // Fake a future auctionEndsAt so the countdown widget has something to display
  const auctionEndsAt = useMemo(() => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), []);

  const scrubStep = useMemo(() => {
    if (replay.totalBidCount <= 1) return 100;
    return 100 / (replay.totalBidCount - 1);
  }, [replay.totalBidCount]);

  useTerminalHotkeys({
    enabled: !replay.isLoading && !replay.isError,
    mode: 'replay',
    replay: {
      isPlaying: replay.isPlaying,
      play: replay.handlePlay,
      pause: replay.handlePause,
      restart: replay.handleRestart,
      speeds: SPEED_OPTIONS,
      setSpeed: (s) => {
        replay.handleSpeedChange(s as SpeedOption);
      },
      scrubBy: (delta) => {
        const next = Math.min(100, Math.max(0, replay.scrubValue + delta * scrubStep));
        replay.handleScrub([next]);
      },
    },
  });

  if (replay.isLoading) {
    return <ReplayLoadingSkeleton />;
  }

  if (replay.isError) {
    return <ReplayNotFound />;
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

      {/* ─── Sticky top bar ─── */}
      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Left: Back + Replay badge */}
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href={`/jobs/${jobId}` as Route}
              className="flex items-center gap-1.5 text-sm text-white/65 transition-colors hover:text-white/80"
              aria-label="Back to job"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div className="h-4 w-px bg-white/10" aria-hidden="true" />
            <Badge className="gap-1 border-blue-500/20 bg-blue-500/10 text-xs text-blue-400">
              <FastForward className="h-3 w-3" />
              Replay
            </Badge>
          </div>

          {/* Center: Job info (hidden on small screens) */}
          <div className="hidden min-w-0 flex-1 items-center justify-center gap-3 text-sm md:flex">
            <h1 className="truncate font-semibold text-white/90">{replay.jobTitle}</h1>
            {replay.category && (
              <div className="flex shrink-0 items-center gap-2 text-white/60">
                <MapPin className="h-3.5 w-3.5" />
                <span>{replay.category}</span>
              </div>
            )}
          </div>

          {/* Right: Playback controls + scrubber + speed */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Transport */}
            <div className="flex items-center gap-1">
              {replay.isPlaying ? (
                <button
                  onClick={replay.handlePause}
                  className="flex h-8 min-w-[44px] items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Pause replay"
                >
                  <Pause className="h-3 w-3" />
                  <span className="hidden sm:inline">Pause</span>
                </button>
              ) : (
                <button
                  onClick={replay.handlePlay}
                  className="flex h-8 min-w-[44px] items-center justify-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/20"
                  aria-label={replay.isComplete ? 'Replay auction' : 'Play replay'}
                >
                  <Play className="h-3 w-3" />
                  <span className="hidden sm:inline">
                    {replay.isComplete ? 'Replay' : replay.sim.bidCount > 0 ? 'Resume' : 'Play'}
                  </span>
                </button>
              )}
              <button
                onClick={replay.handleRestart}
                className="flex h-8 min-h-0 min-w-[44px] items-center justify-center gap-1 rounded-md border border-white/[0.06] bg-transparent px-3 text-xs text-white/60 transition-colors hover:bg-white/5 hover:text-white/70"
                aria-label="Restart replay"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>

            {/* Timeline scrubber (hidden on small screens) */}
            <div
              className="hidden items-center gap-2 lg:flex"
              role="group"
              aria-label="Replay timeline"
            >
              <span className="w-8 text-right text-[10px] text-white/60 tabular-nums">
                {replay.elapsedLabel}
              </span>
              <Slider
                value={[replay.scrubValue]}
                onValueChange={replay.handleScrub}
                max={100}
                step={scrubStep}
                className="w-32"
                aria-label="Scrub through auction replay"
              />
              <span className="w-8 text-[10px] text-white/60 tabular-nums">
                {replay.totalLabel}
              </span>
            </div>

            {/* Speed selector (hidden on very small screens) */}
            <div
              className="hidden items-center gap-0.5 sm:flex"
              role="radiogroup"
              aria-label="Playback speed"
            >
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={replay.speed === s}
                  onClick={() => { replay.handleSpeedChange(s); }}
                  className={`flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-[10px] font-medium transition-colors ${
                    replay.speed === s
                      ? 'bg-white/15 text-white'
                      : 'text-white/40 hover:bg-white/5 hover:text-white/60'
                  }`}
                >
                  {String(s)}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile scrubber row (visible only on small screens) */}
        <div className="flex items-center gap-3 border-t border-white/[0.04] px-4 py-1.5 sm:px-6 lg:hidden">
          <span className="w-8 text-right text-[10px] text-white/60 tabular-nums">
            {replay.elapsedLabel}
          </span>
          <Slider
            value={[replay.scrubValue]}
            onValueChange={replay.handleScrub}
            max={100}
            step={scrubStep}
            className="flex-1"
            aria-label="Scrub through auction replay"
          />
          <span className="w-8 text-[10px] text-white/60 tabular-nums">{replay.totalLabel}</span>
          {/* Mobile speed selector */}
          <div
            className="flex items-center gap-0.5 sm:hidden"
            role="radiogroup"
            aria-label="Playback speed"
          >
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={replay.speed === s}
                onClick={() => { replay.handleSpeedChange(s); }}
                className={`flex h-6 min-w-[24px] items-center justify-center rounded px-1 text-[10px] font-medium transition-colors ${
                  replay.speed === s
                    ? 'bg-white/15 text-white'
                    : 'text-white/40 hover:bg-white/5 hover:text-white/60'
                }`}
              >
                {String(s)}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Terminal toolbar ─── */}
      <div className="relative z-[2] mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
        <TerminalToolbar />
      </div>

      {/* ─── Terminal grid ─── */}
      <div className="relative z-[2] mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
        <TerminalGrid
          sim={replay.sim}
          auctionEndsAt={auctionEndsAt}
          startingPriceCents={replay.startingBidCents}
          marketRange={marketRange}
          mockProviders={replay.mockProviders}
          jobId={jobId}
          snipeExtensionCount={0}
          jobTitle={replay.jobTitle}
          jobDescription={
            replay.jobTitle
              ? `Replay of “${replay.jobTitle}”. Scrub timeline or press Space to play.`
              : 'Auction replay'
          }
          jobCategory={replay.category}
        />
      </div>

      {/* ─── Completion overlay ─── */}
      {replay.isComplete && !overlayDismissed && (
        <CompletionOverlay
          winningBidCents={replay.winningBidCents}
          totalBidCount={replay.totalBidCount}
          totalSavingsCents={replay.totalSavingsCents}
          startingBidCents={replay.startingBidCents}
          onReplay={replay.handleRestart}
          onDismiss={() => { setOverlayDismissed(true); }}
        />
      )}
    </div>
  );
}
