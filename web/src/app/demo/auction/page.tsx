'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

import { SavingsCelebration } from '@/components/bids/SavingsCelebration';
import { TerminalToolbar } from '@/components/terminal/terminal-toolbar';
import { TerminalGrid } from '@/components/terminal/terminal-grid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { AuctionBidEvent, MarketRange } from '@/types';

// ─── Mock data ───────────────────────────────────────────────────────────────

const MOCK_PROVIDERS = [
  { name: "Mike's Premier Plumbing", trust: 94, tier: 'top_rated' as const, initial: 'MP' },
  { name: 'ProBuild Construction', trust: 88, tier: 'trusted' as const, initial: 'PB' },
  { name: 'Elite Home Services', trust: 96, tier: 'top_rated' as const, initial: 'EH' },
  { name: 'Handy Helpers LLC', trust: 72, tier: 'rising' as const, initial: 'HH' },
  { name: 'Metro Renovations', trust: 85, tier: 'trusted' as const, initial: 'MR' },
  { name: 'TopNotch Repairs', trust: 91, tier: 'top_rated' as const, initial: 'TN' },
  { name: 'CityPro Services', trust: 78, tier: 'rising' as const, initial: 'CP' },
  { name: 'AllStar Contractors', trust: 82, tier: 'trusted' as const, initial: 'AS' },
] as const;

const STARTING_PRICE_CENTS = 450000;
const MARKET_RANGE: MarketRange = {
  low_cents: 280000,
  median_cents: 380000,
  high_cents: 520000,
  sample_size: 47,
};

const BID_SCRIPT = [
  { providerIdx: 0, amount: 420000, delayMs: 2000 },
  { providerIdx: 1, amount: 395000, delayMs: 4500 },
  { providerIdx: 3, amount: 410000, delayMs: 6000 },
  { providerIdx: 2, amount: 365000, delayMs: 8500 },
  { providerIdx: 4, amount: 380000, delayMs: 10000 },
  { providerIdx: 0, amount: 355000, delayMs: 13000 },
  { providerIdx: 5, amount: 340000, delayMs: 15500 },
  { providerIdx: 2, amount: 325000, delayMs: 18000 },
  { providerIdx: 1, amount: 335000, delayMs: 20000 },
  { providerIdx: 6, amount: 310000, delayMs: 22500 },
  { providerIdx: 7, amount: 320000, delayMs: 24000 },
  { providerIdx: 2, amount: 295000, delayMs: 27000 },
  { providerIdx: 5, amount: 305000, delayMs: 28500 },
  { providerIdx: 0, amount: 285000, delayMs: 31000 },
  { providerIdx: 2, amount: 270000, delayMs: 34000 },
] as const;

// ─── Simulation hook ─────────────────────────────────────────────────────────

interface SimBid {
  id: string;
  providerIdx: number;
  amount_cents: number;
  created_at: string;
  is_new: boolean;
}

function useAuctionSimulation() {
  const [bids, setBids] = useState<SimBid[]>([]);
  const [events, setEvents] = useState<AuctionBidEvent[]>([]);
  const [isRunning, setIsRunning] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousLowest = useRef<number | undefined>(undefined);

  const currentLowest = useMemo(() => {
    if (bids.length === 0) return 0;
    return Math.min(...bids.map((b) => b.amount_cents));
  }, [bids]);

  useEffect(() => {
    if (currentLowest > 0 && currentLowest !== previousLowest.current) {
      previousLowest.current = currentLowest;
    }
  }, [currentLowest]);

  const start = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setBids([]);
    setEvents([]);
    setShowCelebration(false);
    setIsRunning(true);

    BID_SCRIPT.forEach((script, idx) => {
      const timer = setTimeout(() => {
        const now = new Date().toISOString();
        const bidId = `demo-bid-${String(idx)}`;
        const provider = MOCK_PROVIDERS[script.providerIdx];
        if (!provider) return;

        setBids((prev) => [
          ...prev.map((b) => ({ ...b, is_new: false })),
          {
            id: bidId,
            providerIdx: script.providerIdx,
            amount_cents: script.amount,
            created_at: now,
            is_new: true,
          },
        ]);
        setEvents((prev) => [
          ...prev,
          {
            job_id: 'demo',
            amount_cents: script.amount,
            event_type: 'bid_placed' as const,
            created_at: now,
          },
        ]);

        const flashTimer = setTimeout(() => {
          setBids((prev) => prev.map((b) => (b.id === bidId ? { ...b, is_new: false } : b)));
        }, 2000);
        timersRef.current.push(flashTimer);
      }, script.delayMs);
      timersRef.current.push(timer);
    });

    timersRef.current.push(
      setTimeout(() => {
        setShowCelebration(true);
        setIsRunning(false);
      }, 36000),
    );
  };

  const pause = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setIsRunning(false);
  };
  const reset = () => {
    pause();
    setBids([]);
    setEvents([]);
    setShowCelebration(false);
    previousLowest.current = undefined;
  };

  useEffect(() => {
    start();
    return () => {
      timersRef.current.forEach(clearTimeout);
    }; /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const orderBookBids = useMemo(
    () =>
      bids
        .map((b) => {
          const p = MOCK_PROVIDERS[b.providerIdx];
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
    [bids],
  );

  const depthBuckets = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of orderBookBids) m.set(b.amount_cents, (m.get(b.amount_cents) ?? 0) + 1);
    return Array.from(m.entries())
      .map(([amount_cents, count]) => ({ amount_cents, count }))
      .sort((a, b) => a.amount_cents - b.amount_cents);
  }, [orderBookBids]);

  const activities = useMemo(
    () =>
      [...bids].reverse().map((b) => {
        const p = MOCK_PROVIDERS[b.providerIdx];
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
    [bids, currentLowest],
  );

  const sparklineBids = useMemo(() => bids.map((b) => b.amount_cents), [bids]);

  const velocity = useMemo(() => {
    const cutoff = Date.now() - 15_000;
    return bids.filter((b) => new Date(b.created_at).getTime() >= cutoff).length;
  }, [bids]);

  const velocityBuckets = useMemo(() => {
    const now = Date.now();
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const b of bids) {
      const age = now - new Date(b.created_at).getTime();
      if (age > 60_000) continue;
      const bi = 5 - Math.min(5, Math.floor(age / 10_000));
      if (buckets[bi] !== undefined) buckets[bi]++;
    }
    return buckets;
  }, [bids]);

  return {
    bids,
    events,
    currentLowest,
    previousLowest: previousLowest.current,
    orderBookBids,
    depthBuckets,
    activities,
    sparklineBids,
    velocity,
    velocityBuckets,
    bidCount: bids.length,
    isRunning,
    showCelebration,
    setShowCelebration,
    start,
    pause,
    reset,
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AuctionDemoPage() {
  const sim = useAuctionSimulation();

  const auctionEndsAt = useMemo(() => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), []);
  const savingsCents = STARTING_PRICE_CENTS - sim.currentLowest;
  const savingsPct =
    sim.currentLowest > 0 ? Math.round((savingsCents / STARTING_PRICE_CENTS) * 100) : 0;

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a0a0f 0%, #0d0d15 25%, #0a0f14 50%, #0c0a14 75%, #0a0a0f 100%)' }}>
      {/* Animated gradient mesh background for glass refraction */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div
          className="terminal-blob-1 absolute rounded-full blur-[120px]"
          style={{ top: '15%', left: '20%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(30,40,80,0.35) 0%, transparent 70%)' }}
        />
        <div
          className="terminal-blob-2 absolute rounded-full blur-[100px]"
          style={{ top: '60%', right: '15%', width: '350px', height: '350px', background: 'radial-gradient(circle, rgba(20,60,50,0.25) 0%, transparent 70%)' }}
        />
        <div
          className="terminal-blob-3 absolute rounded-full blur-[140px]"
          style={{ bottom: '20%', left: '40%', width: '450px', height: '450px', background: 'radial-gradient(circle, rgba(50,25,70,0.2) 0%, transparent 70%)' }}
        />
      </div>

      {/* ─── Sticky top bar ─── */}
      <div className="glass-nav sticky top-0 z-50">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div className="bg-border h-4 w-px" />
            <Badge variant="secondary" className="gap-1 text-xs">
              <Zap className="h-3 w-3 text-amber-500" />
              Live Demo
            </Badge>
          </div>

          {/* Job info — inline on desktop */}
          <div className="hidden items-center gap-3 text-sm md:flex">
            <h1 className="font-semibold">Kitchen Renovation — Full Remodel</h1>
            <div className="text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" />
              <span>Austin, TX</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5">
            {sim.isRunning ? (
              <Button
                size="sm"
                variant="outline"
                onClick={sim.pause}
                className="h-8 gap-1 px-3 text-xs"
              >
                <Pause className="h-3 w-3" /> Pause
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={sim.start}
                className="h-8 gap-1 px-3 text-xs"
              >
                <Play className="h-3 w-3" /> {sim.bidCount > 0 ? 'Resume' : 'Start'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={sim.reset}
              className="h-8 gap-1 px-3 text-xs"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* ─── Terminal toolbar ─── */}
      <div className="relative z-10 mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
        <TerminalToolbar />
      </div>

      {/* ─── Terminal grid ─── */}
      <div className="relative z-10 mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
        <TerminalGrid
          sim={sim}
          auctionEndsAt={auctionEndsAt}
          startingPriceCents={STARTING_PRICE_CENTS}
          marketRange={MARKET_RANGE}
          mockProviders={MOCK_PROVIDERS}
        />
      </div>

      {/* Celebration */}
      {savingsCents > 0 && (
        <SavingsCelebration
          savingsPercent={savingsPct}
          isVisible={sim.showCelebration}
          onDismiss={() => sim.setShowCelebration(false)}
        />
      )}
    </div>
  );
}
