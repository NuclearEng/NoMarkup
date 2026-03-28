'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Pause, Play, RotateCcw, TrendingDown, Trophy, Users, Zap } from 'lucide-react';

import { AnimatedPrice } from '@/components/bids/AnimatedPrice';
import { useAuctionReplay } from '@/hooks/useAuctionReplay';
import { PriceDropChart } from '@/components/bids/PriceDropChart';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { formatCents } from '@/lib/utils';
import type { AuctionBidEvent } from '@/types';

interface AuctionReplayProps {
  jobId: string;
}

const SPEED_OPTIONS = [1, 2, 5, 10] as const;

export function AuctionReplay({ jobId }: AuctionReplayProps) {
  const { data, isLoading, isError } = useAuctionReplay(jobId);
  const [currentEventIndex, setCurrentEventIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(5);
  const [isComplete, setIsComplete] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute the visible events up to the current index.
  const visibleEvents = useMemo(() => {
    if (!data) return [];
    if (currentEventIndex < 0) return [];
    return data.events.slice(0, currentEventIndex + 1);
  }, [data, currentEventIndex]);

  // Convert visible events to AuctionBidEvent format for PriceDropChart.
  const chartEvents: AuctionBidEvent[] = useMemo(
    () =>
      visibleEvents.map((ev) => ({
        job_id: ev.job_id,
        amount_cents: ev.amount_cents,
        event_type: ev.event_type,
        created_at: ev.created_at,
      })),
    [visibleEvents],
  );

  // Compute current stats from visible events.
  const currentStats = useMemo(() => {
    let lowestBid = 0;
    let bidCount = 0;

    for (const ev of visibleEvents) {
      if (ev.event_type === 'bid_placed' || ev.event_type === 'bid_updated') {
        bidCount++;
        if (lowestBid === 0 || ev.amount_cents < lowestBid) {
          lowestBid = ev.amount_cents;
        }
      }
    }

    return { lowestBid, bidCount };
  }, [visibleEvents]);

  // Compute elapsed replay time.
  const elapsedLabel = useMemo(() => {
    if (!data || visibleEvents.length === 0) return '0:00';

    const firstEvent = data.events[0];
    const lastVisible = visibleEvents[visibleEvents.length - 1];
    if (!firstEvent || !lastVisible) return '0:00';

    const elapsed =
      (new Date(lastVisible.created_at).getTime() - new Date(firstEvent.created_at).getTime()) /
      1000;
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }, [data, visibleEvents]);

  // Total duration label.
  const totalLabel = useMemo(() => {
    if (!data) return '0:00';
    const total = data.duration_seconds;
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }, [data]);

  // Clear timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const scheduleNextEvent = useCallback(
    (fromIndex: number) => {
      if (!data) return;
      const nextIndex = fromIndex + 1;

      if (nextIndex >= data.events.length) {
        setIsPlaying(false);
        setIsComplete(true);
        return;
      }

      const currentEvent = data.events[fromIndex];
      const nextEvent = data.events[nextIndex];
      if (!currentEvent || !nextEvent) return;

      // Calculate the real time gap and compress it by the speed factor.
      const realGapMs =
        new Date(nextEvent.created_at).getTime() - new Date(currentEvent.created_at).getTime();
      // Compress time, but cap the minimum delay at 100ms for visibility and max at 3s.
      const delay = Math.max(100, Math.min(3000, realGapMs / speed));

      timerRef.current = setTimeout(() => {
        setCurrentEventIndex(nextIndex);
      }, delay);
    },
    [data, speed],
  );

  // When currentEventIndex changes and we are playing, schedule the next event.
  useEffect(() => {
    if (isPlaying && data && currentEventIndex >= 0) {
      scheduleNextEvent(currentEventIndex);
    }
  }, [currentEventIndex, isPlaying, data, scheduleNextEvent]);

  function handlePlay() {
    if (!data || data.events.length === 0) return;

    if (isComplete) {
      // Restart from the beginning.
      setIsComplete(false);
      setCurrentEventIndex(0);
      setIsPlaying(true);
      return;
    }

    if (currentEventIndex < 0) {
      // Start from the first event.
      setCurrentEventIndex(0);
    }
    setIsPlaying(true);
  }

  function handlePause() {
    setIsPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleRestart() {
    handlePause();
    setIsComplete(false);
    setCurrentEventIndex(-1);
  }

  function handleScrub(value: number[]) {
    if (!data) return;
    const scrubValue = value[0];
    if (scrubValue === undefined) return;

    handlePause();
    setIsComplete(false);
    const index = Math.round((scrubValue / 100) * (data.events.length - 1));
    setCurrentEventIndex(Math.max(-1, Math.min(index, data.events.length - 1)));
  }

  function handleSpeedChange(newSpeed: (typeof SPEED_OPTIONS)[number]) {
    setSpeed(newSpeed);
    // If playing, the useEffect will reschedule with the new speed on the next tick.
  }

  if (isLoading) {
    return (
      <div className="border-border/50 bg-card overflow-hidden rounded-xl border shadow-lg">
        <div className="px-4 py-3 sm:px-6">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="px-4 py-8 sm:px-6">
          <Skeleton className="mx-auto h-12 w-48" />
          <Skeleton className="mx-auto mt-4 h-4 w-32" />
        </div>
        <div className="px-4 pb-4 sm:px-6">
          <Skeleton className="h-[220px] w-full rounded-lg" />
        </div>
        <div className="px-4 pb-4 sm:px-6">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="border-border/50 bg-card overflow-hidden rounded-xl border p-6 text-center shadow-lg">
        <p className="text-muted-foreground text-sm">
          Failed to load auction replay. The auction data may not be available yet.
        </p>
      </div>
    );
  }

  if (data.events.length === 0) {
    return (
      <div className="border-border/50 bg-card overflow-hidden rounded-xl border p-6 text-center shadow-lg">
        <p className="text-muted-foreground text-sm">
          No bid events recorded for this auction.
        </p>
      </div>
    );
  }

  const scrubValue =
    data.events.length > 1
      ? (Math.max(0, currentEventIndex) / (data.events.length - 1)) * 100
      : 0;

  const savingsSoFar =
    data.starting_bid_cents > 0 && currentStats.lowestBid > 0
      ? data.starting_bid_cents - currentStats.lowestBid
      : 0;

  return (
    <div className="border-border/50 bg-card overflow-hidden rounded-xl border shadow-lg">
      <style>{`
        @keyframes replayPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); }
          50% { opacity: 0.8; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0); }
        }
        @keyframes celebrationPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes confettiFade {
          0% { opacity: 1; transform: translateY(0) rotate(0deg); }
          100% { opacity: 0; transform: translateY(20px) rotate(180deg); }
        }
      `}</style>

      {/* Header banner */}
      <div
        className="relative px-4 py-3 sm:px-6"
        style={{
          background:
            'linear-gradient(135deg, rgba(10, 10, 10, 0.95) 0%, rgba(20, 20, 20, 0.8) 50%, transparent 100%)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Zap className="h-5 w-5 text-blue-400" aria-hidden="true" />
            <h2 className="text-foreground text-sm font-bold tracking-widest uppercase">
              Auction Replay
            </h2>
          </div>
          <div className="flex items-center gap-2" role="status" aria-label="Replay status">
            {isPlaying ? (
              <>
                <div
                  className="h-2 w-2 rounded-full bg-blue-500"
                  style={{ animation: 'replayPulse 2s ease-in-out infinite' }}
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-blue-400">PLAYING</span>
              </>
            ) : isComplete ? (
              <>
                <div className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                <span className="text-xs font-medium text-green-400">COMPLETE</span>
              </>
            ) : (
              <>
                <div className="bg-muted-foreground/40 h-2 w-2 rounded-full" aria-hidden="true" />
                <span className="text-muted-foreground text-xs font-medium">PAUSED</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Hero price display */}
      <div className="px-4 pt-5 pb-2 text-center sm:px-6 sm:pt-6">
        {data.starting_bid_cents > 0 ? (
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Starting at {formatCents(data.starting_bid_cents)}
          </p>
        ) : null}

        <div
          className="text-4xl font-black tracking-tight text-green-500 sm:text-5xl"
          role="status"
          aria-live="polite"
          aria-label={
            currentStats.lowestBid > 0
              ? `Current lowest bid: ${formatCents(currentStats.lowestBid)}`
              : 'No bids yet'
          }
        >
          <AnimatedPrice cents={currentStats.lowestBid} />
        </div>

        <p className="text-muted-foreground mt-1 text-xs">
          {isComplete ? 'Final Winning Bid' : 'Current Lowest Bid'}
        </p>

        {/* Savings pill */}
        {savingsSoFar > 0 ? (
          <div
            className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3.5 py-1.5"
            role="status"
            aria-label={`Saving ${formatCents(savingsSoFar)} from starting price`}
          >
            <TrendingDown className="h-3.5 w-3.5 text-green-400" aria-hidden="true" />
            <span className="text-xs font-bold text-green-400">
              Saving {formatCents(savingsSoFar)} from starting price
            </span>
          </div>
        ) : null}
      </div>

      {/* Stats row */}
      <div className="border-border/30 bg-border/20 mx-4 my-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border-y sm:mx-6">
        {/* Bids */}
        <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
          <div className="flex items-center gap-1">
            <Users className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              Bids
            </span>
          </div>
          <p
            className="text-xl font-bold tabular-nums sm:text-2xl"
            role="status"
            aria-live="polite"
            aria-label={`${String(currentStats.bidCount)} bids`}
          >
            {String(currentStats.bidCount)}
          </p>
        </div>

        {/* Elapsed time */}
        <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              Elapsed
            </span>
          </div>
          <p className="text-foreground text-xl font-bold tabular-nums sm:text-2xl">
            {elapsedLabel}
          </p>
        </div>

        {/* Speed */}
        <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
          <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Speed
          </span>
          <p className="text-foreground text-xl font-bold tabular-nums sm:text-2xl">
            {String(speed)}x
          </p>
        </div>
      </div>

      {/* Price History Chart */}
      <div className="px-4 pb-2 sm:px-6">
        <h3 className="text-muted-foreground/70 mb-2 text-xs font-medium tracking-wider uppercase">
          Price History
        </h3>
        <PriceDropChart events={chartEvents} />
      </div>

      {/* Timeline scrubber */}
      <div className="px-4 pt-2 pb-1 sm:px-6">
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label="Replay timeline controls"
        >
          <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
            {elapsedLabel}
          </span>
          <Slider
            value={[scrubValue]}
            onValueChange={handleScrub}
            max={100}
            step={data.events.length > 1 ? 100 / (data.events.length - 1) : 100}
            className="flex-1"
            aria-label="Scrub through auction replay"
          />
          <span className="text-muted-foreground w-10 text-xs tabular-nums">{totalLabel}</span>
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-between px-4 pt-2 pb-4 sm:px-6">
        {/* Transport controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="min-h-[44px] min-w-[44px]"
            onClick={handleRestart}
            aria-label="Restart replay"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          <Button
            className="min-h-[44px] min-w-[44px]"
            size="icon"
            onClick={isPlaying ? handlePause : handlePlay}
            aria-label={isPlaying ? 'Pause replay' : isComplete ? 'Replay auction' : 'Play replay'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>

        {/* Speed selector */}
        <div
          className="flex items-center gap-1"
          role="radiogroup"
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              onClick={() => {
                handleSpeedChange(s);
              }}
              className={`min-h-[44px] min-w-[44px] rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                speed === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {String(s)}x
            </button>
          ))}
        </div>
      </div>

      {/* Completion celebration */}
      {isComplete ? (
        <div className="border-border/30 border-t px-4 py-6 text-center sm:px-6">
          <div
            className="inline-flex items-center gap-2 rounded-full bg-green-500/15 px-4 py-2"
            style={{ animation: 'celebrationPulse 2s ease-in-out infinite' }}
          >
            <Trophy className="h-5 w-5 text-green-400" aria-hidden="true" />
            <span className="text-sm font-bold text-green-400">Auction Complete</span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Final Price</p>
              <p className="text-lg font-bold text-green-500">
                {formatCents(data.winning_bid_cents)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Total Bids</p>
              <p className="text-foreground text-lg font-bold">{String(data.bid_count)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Saved</p>
              <p className="text-lg font-bold text-green-500">
                {data.total_savings_cents > 0 ? formatCents(data.total_savings_cents) : '$0'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
