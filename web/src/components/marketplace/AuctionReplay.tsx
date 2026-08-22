'use client';

// Goods-marketplace auction replay — scrubbable timeline of every bid
// on a closed listing. Mirrors the services-side AuctionReplay component
// but reads the listing-replay payload (PII-stripped bidder labels,
// snipe extension synthetics, auto-bid cascade detection).
//
// Replay speed: 1 second of replay = 30 seconds of auction wall-clock.

import { Pause, Play, RotateCcw, Trophy, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { useListingReplay } from '@/hooks/useAuctionReplay';
import { formatCents } from '@/lib/utils';

interface AuctionReplayProps {
  listingId: string;
}

// 1 second of replay = REPLAY_TIME_COMPRESSION seconds of auction time.
// 30x is fast enough to keep watch time modest on multi-hour auctions
// while still letting individual bids land visibly.
const REPLAY_TIME_COMPRESSION = 30;

const SPEED_OPTIONS = [1, 2, 4] as const;

export function AuctionReplay({ listingId }: AuctionReplayProps) {
  const { data, isLoading, isError } = useListingReplay(listingId);
  // First paint must match SSR (pending query). Showing empty/error on the
  // client before the query resolves caused a hydration mismatch vs the
  // loading skeleton.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const [currentEventIndex, setCurrentEventIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
  const [isComplete, setIsComplete] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleEvents = useMemo(() => {
    if (!data) return [];
    if (currentEventIndex < 0) return [];
    return data.events.slice(0, currentEventIndex + 1);
  }, [data, currentEventIndex]);

  const currentStats = useMemo(() => {
    let highestBid = 0;
    let bidCount = 0;
    for (const ev of visibleEvents) {
      if (ev.type === 'bid_placed' && typeof ev.amount_cents === 'number') {
        bidCount++;
        if (ev.amount_cents > highestBid) {
          highestBid = ev.amount_cents;
        }
      }
    }
    return { highestBid, bidCount };
  }, [visibleEvents]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
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
      // Compute compressed delay: 1s replay = REPLAY_TIME_COMPRESSION seconds
      // of auction. Then divide further by the user-selected speed.
      const realGapMs =
        new Date(nextEvent.at).getTime() - new Date(currentEvent.at).getTime();
      const compressedMs = realGapMs / REPLAY_TIME_COMPRESSION / speed;
      const delay = Math.max(120, Math.min(3000, compressedMs));
      timerRef.current = setTimeout(() => {
        setCurrentEventIndex(nextIndex);
      }, delay);
    },
    [data, speed],
  );

  useEffect(() => {
    if (isPlaying && data && currentEventIndex >= 0) {
      scheduleNextEvent(currentEventIndex);
    }
  }, [currentEventIndex, isPlaying, data, scheduleNextEvent]);

  function handlePlay() {
    if (!data || data.events.length === 0) return;
    if (isComplete) {
      setIsComplete(false);
      setCurrentEventIndex(0);
      setIsPlaying(true);
      return;
    }
    if (currentEventIndex < 0) setCurrentEventIndex(0);
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
    const v = value[0];
    if (v === undefined) return;
    handlePause();
    setIsComplete(false);
    const idx = Math.round((v / 100) * (data.events.length - 1));
    setCurrentEventIndex(Math.max(-1, Math.min(idx, data.events.length - 1)));
  }

  if (!ready || isLoading) {
    return (
      <div className="border-border/50 bg-card overflow-hidden rounded-xl border shadow-lg">
        <div className="px-4 py-3 sm:px-6">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="px-4 py-8 sm:px-6">
          <Skeleton className="mx-auto h-12 w-48" />
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
          Failed to load auction replay. The listing may still be live, or the data
          isn&rsquo;t available yet.
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

  return (
    <div className="border-border/50 bg-card overflow-hidden rounded-xl border shadow-lg">
      <div className="border-border/30 flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Zap className="h-5 w-5 text-bid-active" aria-hidden="true" />
          <h2 className="text-foreground text-sm font-bold tracking-widest uppercase">
            Auction Replay
          </h2>
        </div>
        <span
          className="text-xs font-medium text-muted-foreground"
          aria-live="polite"
        >
          {isPlaying ? 'PLAYING' : isComplete ? 'COMPLETE' : 'PAUSED'}
        </span>
      </div>

      {/* Hero price */}
      <div className="px-4 pt-5 pb-2 text-center sm:px-6 sm:pt-6">
        <p
          className="text-4xl font-black tracking-tight text-bid-winning sm:text-5xl"
          role="status"
          aria-live="polite"
        >
          {currentStats.highestBid > 0
            ? formatCents(currentStats.highestBid)
            : 'No bids yet'}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {isComplete ? 'Final winning bid' : 'Current high bid'}
        </p>
      </div>

      {/* Stats */}
      <div className="border-border/30 mx-4 my-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border-y bg-border/20 sm:mx-6">
        <Stat label="Bids" value={String(currentStats.bidCount)} />
        <Stat label="Speed" value={`${String(speed)}x`} />
        <Stat
          label="Events"
          value={`${String(visibleEvents.length)} / ${String(data.events.length)}`}
        />
      </div>

      {/* Events list */}
      <ul
        className="border-border/30 max-h-44 space-y-1 overflow-y-auto border-t px-4 py-2 text-xs sm:px-6"
        aria-label="Bid history"
      >
        {visibleEvents.map((ev, i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-muted-foreground">
              {ev.type.replace(/_/g, ' ')}
            </span>
            <span className="text-foreground font-medium">
              {ev.anonymized_bidder ?? ''}
              {typeof ev.amount_cents === 'number'
                ? ` · ${formatCents(ev.amount_cents)}`
                : ''}
            </span>
          </li>
        ))}
      </ul>

      {/* Scrubber */}
      <div className="px-4 pt-2 pb-1 sm:px-6">
        <Slider
          value={[scrubValue]}
          onValueChange={handleScrub}
          max={100}
          step={data.events.length > 1 ? 100 / (data.events.length - 1) : 100}
          aria-label="Scrub through auction replay"
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-4 pt-2 pb-4 sm:px-6">
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
            aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>
        <div role="radiogroup" aria-label="Playback speed" className="flex gap-1">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              onClick={() => {
                setSpeed(s);
              }}
              className={
                'min-h-[44px] min-w-[44px] rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ' +
                (speed === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80')
              }
            >
              {String(s)}x
            </button>
          ))}
        </div>
      </div>

      {/* Completion celebration */}
      {isComplete ? (
        <div className="border-border/30 border-t px-4 py-4 text-center sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-bid-winning/15 px-4 py-2">
            <Trophy className="h-5 w-5 text-bid-winning" aria-hidden="true" />
            <span className="text-sm font-bold text-bid-winning">
              Auction complete
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </span>
      <p className="text-foreground text-xl font-bold tabular-nums sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
