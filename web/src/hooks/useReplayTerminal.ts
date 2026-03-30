'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuctionReplay } from '@/hooks/useAuctionReplay';
import type { AuctionBidEvent } from '@/types';
import type { SimulationData } from '@/components/terminal/types';

// ── Constants ────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [1, 2, 5, 10] as const;
type SpeedOption = (typeof SPEED_OPTIONS)[number];

const FLASH_DURATION_MS = 2000;
const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 3000;

// ── Anonymous provider generator ─────────────────────────────────────────────

const PROVIDER_NAMES = [
  'Provider Alpha',
  'Provider Bravo',
  'Provider Charlie',
  'Provider Delta',
  'Provider Echo',
  'Provider Foxtrot',
  'Provider Golf',
  'Provider Hotel',
  'Provider India',
  'Provider Juliet',
  'Provider Kilo',
  'Provider Lima',
] as const;

const TRUST_TIERS = ['trusted', 'top_rated', 'rising', 'trusted', 'top_rated', 'rising'] as const;
const TRUST_SCORES = [88, 94, 76, 85, 92, 80] as const;

function getProviderInfo(providerIndex: number) {
  const name = PROVIDER_NAMES[providerIndex % PROVIDER_NAMES.length] ?? `Provider ${String(providerIndex + 1)}`;
  const trust = TRUST_SCORES[providerIndex % TRUST_SCORES.length] ?? 80;
  const tier = TRUST_TIERS[providerIndex % TRUST_TIERS.length] ?? 'trusted';
  const initial = name.split(' ').map((w) => w.charAt(0)).join('').slice(0, 2);
  return { name, trust, tier, initial };
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ReplayBid {
  id: string;
  providerIdx: number;
  amount_cents: number;
  created_at: string;
  is_new: boolean;
}

interface ReplayTerminalState {
  /** Data from useAuctionReplay */
  isLoading: boolean;
  isError: boolean;
  jobTitle: string;
  category: string;
  startingBidCents: number;
  winningBidCents: number;
  totalSavingsCents: number;
  durationSeconds: number;
  totalBidCount: number;
  /** Playback controls */
  isPlaying: boolean;
  isComplete: boolean;
  speed: SpeedOption;
  scrubValue: number;
  elapsedLabel: string;
  totalLabel: string;
  handlePlay: () => void;
  handlePause: () => void;
  handleRestart: () => void;
  handleScrub: (value: number[]) => void;
  handleSpeedChange: (speed: SpeedOption) => void;
  /** SimulationData-compatible output for TerminalGrid */
  sim: SimulationData;
  /** Mock providers for TerminalGrid */
  mockProviders: readonly { name: string; trust: number; tier: string; initial: string }[];
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export { SPEED_OPTIONS };
export type { SpeedOption };

export function useReplayTerminal(jobId: string): ReplayTerminalState {
  const { data, isLoading, isError } = useAuctionReplay(jobId);

  // ── Playback state ──────────────────────────────────────────────────────
  const [currentEventIndex, setCurrentEventIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [speed, setSpeed] = useState<SpeedOption>(5);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [showCelebration, setShowCelebration] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousLowestRef = useRef<number | undefined>(undefined);

  // ── Build a stable provider mapping from event IDs ──────────────────────
  const providerMap = useMemo(() => {
    if (!data) return new Map<string, number>();
    const map = new Map<string, number>();
    let nextIdx = 0;
    for (const event of data.events) {
      if (!map.has(event.id)) {
        map.set(event.id, nextIdx);
        nextIdx++;
      }
    }
    return map;
  }, [data]);

  // ── Mock providers list (generated from providerMap) ────────────────────
  const mockProviders = useMemo(() => {
    const count = providerMap.size > 0 ? Math.max(...Array.from(providerMap.values())) + 1 : 8;
    return Array.from({ length: count }, (_, i) => getProviderInfo(i));
  }, [providerMap]);

  // ── Visible events (up to currentEventIndex) ───────────────────────────
  const visibleEvents = useMemo(() => {
    if (!data || currentEventIndex < 0) return [];
    return data.events.slice(0, currentEventIndex + 1);
  }, [data, currentEventIndex]);

  // ── Convert visible events to internal bids ─────────────────────────────
  const bids: ReplayBid[] = useMemo(
    () =>
      visibleEvents.map((ev) => ({
        id: ev.id,
        providerIdx: providerMap.get(ev.id) ?? 0,
        amount_cents: ev.amount_cents,
        created_at: ev.created_at,
        is_new: flashIds.has(ev.id),
      })),
    [visibleEvents, providerMap, flashIds],
  );

  // ── AuctionBidEvent array for terminal widgets ──────────────────────────
  const events: AuctionBidEvent[] = useMemo(
    () =>
      visibleEvents.map((ev) => ({
        job_id: ev.job_id,
        amount_cents: ev.amount_cents,
        event_type: ev.event_type,
        created_at: ev.created_at,
      })),
    [visibleEvents],
  );

  // ── Current lowest bid ──────────────────────────────────────────────────
  const currentLowest = useMemo(() => {
    if (bids.length === 0) return 0;
    return Math.min(...bids.map((b) => b.amount_cents));
  }, [bids]);

  // Track previousLowest
  useEffect(() => {
    if (currentLowest > 0 && currentLowest !== previousLowestRef.current) {
      previousLowestRef.current = currentLowest;
    }
  }, [currentLowest]);

  // ── Order book bids ─────────────────────────────────────────────────────
  const orderBookBids = useMemo(
    () =>
      bids
        .map((b) => {
          const p = mockProviders[b.providerIdx];
          return {
            id: b.id,
            provider_name: p?.name ?? '',
            amount_cents: b.amount_cents,
            trust_score: p?.trust ?? 0,
            trust_tier: p?.tier ?? 'new',
            created_at: b.created_at,
            is_new: b.is_new,
          };
        })
        .sort((a, b) => a.amount_cents - b.amount_cents),
    [bids, mockProviders],
  );

  // ── Depth buckets ───────────────────────────────────────────────────────
  const depthBuckets = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of orderBookBids) {
      m.set(b.amount_cents, (m.get(b.amount_cents) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([amount_cents, count]) => ({ amount_cents, count }))
      .sort((a, b) => a.amount_cents - b.amount_cents);
  }, [orderBookBids]);

  // ── Activities feed ─────────────────────────────────────────────────────
  const activities = useMemo(
    () =>
      [...bids].reverse().map((b) => {
        const p = mockProviders[b.providerIdx];
        return {
          id: b.id,
          providerName: p?.name ?? '',
          amount: b.amount_cents,
          timestamp: new Date(b.created_at).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          }),
          isLowest: b.amount_cents === currentLowest,
        };
      }),
    [bids, mockProviders, currentLowest],
  );

  // ── Sparkline bids ──────────────────────────────────────────────────────
  const sparklineBids = useMemo(() => bids.map((b) => b.amount_cents), [bids]);

  // ── Velocity (bids in last 15s of replay time) ──────────────────────────
  const velocity = useMemo(() => {
    if (bids.length === 0) return 0;
    const latestTime = new Date(bids[bids.length - 1]?.created_at ?? 0).getTime();
    const cutoff = latestTime - 15_000;
    return bids.filter((b) => new Date(b.created_at).getTime() >= cutoff).length;
  }, [bids]);

  // ── Velocity buckets (6 x 10s buckets) ─────────────────────────────────
  const velocityBuckets = useMemo(() => {
    if (bids.length === 0) return [0, 0, 0, 0, 0, 0];
    const latestTime = new Date(bids[bids.length - 1]?.created_at ?? 0).getTime();
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const b of bids) {
      const age = latestTime - new Date(b.created_at).getTime();
      if (age > 60_000) continue;
      const bi = 5 - Math.min(5, Math.floor(age / 10_000));
      if (buckets[bi] !== undefined) buckets[bi]++;
    }
    return buckets;
  }, [bids]);

  // ── Elapsed and total labels ────────────────────────────────────────────
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

  const totalLabel = useMemo(() => {
    if (!data) return '0:00';
    const total = data.duration_seconds;
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }, [data]);

  // ── Scrub value (0-100) ─────────────────────────────────────────────────
  const scrubValue = useMemo(() => {
    if (!data || data.events.length <= 1) return 0;
    return (Math.max(0, currentEventIndex) / (data.events.length - 1)) * 100;
  }, [data, currentEventIndex]);

  // ── Cleanup timers on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      flashTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // ── Schedule next event ─────────────────────────────────────────────────
  const scheduleNextEvent = useCallback(
    (fromIndex: number) => {
      if (!data) return;
      const nextIndex = fromIndex + 1;

      if (nextIndex >= data.events.length) {
        setIsPlaying(false);
        setIsComplete(true);
        setShowCelebration(true);
        return;
      }

      const currentEvent = data.events[fromIndex];
      const nextEvent = data.events[nextIndex];
      if (!currentEvent || !nextEvent) return;

      const realGapMs =
        new Date(nextEvent.created_at).getTime() - new Date(currentEvent.created_at).getTime();
      const delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, realGapMs / speed));

      timerRef.current = setTimeout(() => {
        setCurrentEventIndex(nextIndex);

        // Flash the new event
        const newEventId = nextEvent.id;
        setFlashIds((prev) => new Set([...prev, newEventId]));
        const flashTimer = setTimeout(() => {
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.delete(newEventId);
            return next;
          });
        }, FLASH_DURATION_MS);
        flashTimersRef.current.push(flashTimer);
      }, delay);
    },
    [data, speed],
  );

  // ── When currentEventIndex changes and playing, schedule next ───────────
  useEffect(() => {
    if (isPlaying && data && currentEventIndex >= 0) {
      scheduleNextEvent(currentEventIndex);
    }
  }, [currentEventIndex, isPlaying, data, scheduleNextEvent]);

  // ── Playback handlers ──────────────────────────────────────────────────

  const handlePlay = useCallback(() => {
    if (!data || data.events.length === 0) return;

    if (isComplete) {
      setIsComplete(false);
      setShowCelebration(false);
      setFlashIds(new Set());
      setCurrentEventIndex(0);
      setIsPlaying(true);

      // Flash the first event
      const firstId = data.events[0]?.id;
      if (firstId) {
        setFlashIds(new Set([firstId]));
        const flashTimer = setTimeout(() => {
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.delete(firstId);
            return next;
          });
        }, FLASH_DURATION_MS);
        flashTimersRef.current.push(flashTimer);
      }
      return;
    }

    if (currentEventIndex < 0) {
      setCurrentEventIndex(0);

      // Flash the first event
      const firstId = data.events[0]?.id;
      if (firstId) {
        setFlashIds(new Set([firstId]));
        const flashTimer = setTimeout(() => {
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.delete(firstId);
            return next;
          });
        }, FLASH_DURATION_MS);
        flashTimersRef.current.push(flashTimer);
      }
    }
    setIsPlaying(true);
  }, [data, isComplete, currentEventIndex]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleRestart = useCallback(() => {
    handlePause();
    setIsComplete(false);
    setShowCelebration(false);
    setFlashIds(new Set());
    setCurrentEventIndex(-1);
    previousLowestRef.current = undefined;
  }, [handlePause]);

  const handleScrub = useCallback(
    (value: number[]) => {
      if (!data) return;
      const scrubVal = value[0];
      if (scrubVal === undefined) return;

      handlePause();
      setIsComplete(false);
      setShowCelebration(false);
      setFlashIds(new Set());
      const index = Math.round((scrubVal / 100) * (data.events.length - 1));
      setCurrentEventIndex(Math.max(-1, Math.min(index, data.events.length - 1)));
    },
    [data, handlePause],
  );

  const handleSpeedChange = useCallback((newSpeed: SpeedOption) => {
    setSpeed(newSpeed);
  }, []);

  // ── Assemble SimulationData ─────────────────────────────────────────────
  const sim: SimulationData = useMemo(
    () => ({
      bids,
      events,
      currentLowest,
      previousLowest: previousLowestRef.current,
      orderBookBids,
      depthBuckets,
      activities,
      sparklineBids,
      velocity,
      velocityBuckets,
      bidCount: bids.length,
      isRunning: isPlaying,
      showCelebration,
      setShowCelebration,
      start: handlePlay,
      pause: handlePause,
      reset: handleRestart,
    }),
    [
      bids,
      events,
      currentLowest,
      orderBookBids,
      depthBuckets,
      activities,
      sparklineBids,
      velocity,
      velocityBuckets,
      isPlaying,
      showCelebration,
      handlePlay,
      handlePause,
      handleRestart,
    ],
  );

  return {
    isLoading,
    isError,
    jobTitle: data?.job_title ?? '',
    category: data?.category ?? '',
    startingBidCents: data?.starting_bid_cents ?? 0,
    winningBidCents: data?.winning_bid_cents ?? 0,
    totalSavingsCents: data?.total_savings_cents ?? 0,
    durationSeconds: data?.duration_seconds ?? 0,
    totalBidCount: data?.bid_count ?? 0,
    isPlaying,
    isComplete,
    speed,
    scrubValue,
    elapsedLabel,
    totalLabel,
    handlePlay,
    handlePause,
    handleRestart,
    handleScrub,
    handleSpeedChange,
    sim,
    mockProviders,
  };
}
