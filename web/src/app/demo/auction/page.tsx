'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  ChevronDown,
  Clock,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Star,
  TrendingDown,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

import { AnimatedPrice } from '@/components/bids/AnimatedPrice';
import { BidActivityFeed } from '@/components/bids/BidActivityFeed';
import { BidPriceChart } from '@/components/bids/BidPriceChart';
import { OrderBook } from '@/components/bids/OrderBook';
import { BidDepthChart } from '@/components/bids/BidDepthChart';
import { BidVelocityIndicator } from '@/components/bids/BidVelocityIndicator';
import { PriceDropChart } from '@/components/bids/PriceDropChart';
import { SavingsHero } from '@/components/bids/SavingsHero';
import { SnipeIndicator } from '@/components/bids/SnipeIndicator';
import { SavingsCelebration } from '@/components/bids/SavingsCelebration';
import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { AuctionTimer } from '@/components/jobs/AuctionTimer';
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

function fmt(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

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

// ─── Tier colors ─────────────────────────────────────────────────────────────

const TIER_COLORS = {
  top_rated: { bg: 'bg-amber-500/15', text: 'text-amber-500', ring: 'ring-amber-500/30' },
  trusted: { bg: 'bg-violet-500/15', text: 'text-violet-500', ring: 'ring-violet-500/30' },
  rising: { bg: 'bg-emerald-500/15', text: 'text-emerald-500', ring: 'ring-emerald-500/30' },
  new: { bg: 'bg-sky-500/15', text: 'text-sky-500', ring: 'ring-sky-500/30' },
} as const;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AuctionDemoPage() {
  const sim = useAuctionSimulation();
  const [vizTab, setVizTab] = useState<'price' | 'depth' | 'trend'>('price');
  const [showJobDetails, setShowJobDetails] = useState(false);

  const auctionEndsAt = useMemo(() => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), []);
  const savingsCents = STARTING_PRICE_CENTS - sim.currentLowest;
  const savingsPct =
    sim.currentLowest > 0 ? Math.round((savingsCents / STARTING_PRICE_CENTS) * 100) : 0;

  return (
    <div className="bg-background min-h-screen">
      {/* ─── Sticky top bar ─── */}
      <div className="bg-card/80 sticky top-0 z-50 border-b backdrop-blur-xl">
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

      {/* ─── Main content: Trading terminal layout ─── */}
      <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
        {/* ─── Hero strip: Price + Stats + Savings ─── */}
        <div className="border-border/50 bg-card mb-6 overflow-hidden rounded-2xl border shadow-lg">
          {/* Gold accent top line */}
          <div
            className="h-0.5"
            style={{
              background:
                'linear-gradient(90deg, transparent, var(--brand-gold-dim), var(--brand-gold), var(--brand-gold-bright), transparent)',
            }}
          />

          <div className="divide-border/30 grid gap-0 divide-x sm:grid-cols-[1fr_auto_auto_auto]">
            {/* Price cell — hero */}
            <div className="relative flex items-center gap-5 px-6 py-5 sm:py-6">
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-green-400" />
                  <span className="text-muted-foreground text-[11px] font-bold tracking-widest uppercase">
                    Current Lowest Bid
                  </span>
                  {sim.isRunning ? (
                    <span className="flex items-center gap-1">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                      </span>
                      <span className="text-[10px] font-medium text-green-400">LIVE</span>
                    </span>
                  ) : null}
                  {sim.velocity > 0 && (
                    <BidVelocityIndicator velocity={sim.velocity} buckets={sim.velocityBuckets} />
                  )}
                </div>
                <div className="flex items-baseline gap-3">
                  <span
                    className="text-4xl font-black tracking-tight text-green-500 sm:text-5xl"
                    style={{ textShadow: '0 0 30px rgba(34,197,94,0.2)' }}
                  >
                    {sim.currentLowest > 0 ? (
                      <AnimatedPrice cents={sim.currentLowest} formatCurrency={fmt} />
                    ) : (
                      <span className="text-muted-foreground/40">Waiting...</span>
                    )}
                  </span>
                  {sim.currentLowest > 0 && (
                    <span className="text-muted-foreground text-sm tabular-nums line-through">
                      {fmt(STARTING_PRICE_CENTS)}
                    </span>
                  )}
                </div>
                {savingsCents > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      Save {fmt(savingsCents)} ({String(savingsPct)}%)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Bids stat */}
            <div className="flex flex-col items-center justify-center px-6 py-4 sm:px-8">
              <Users className="text-muted-foreground mb-1 h-4 w-4" />
              <p className="text-2xl font-bold tabular-nums">{String(sim.bidCount)}</p>
              <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                Bids
              </p>
            </div>

            {/* Timer stat */}
            <div className="flex flex-col items-center justify-center px-6 py-4 sm:px-8">
              <Clock className="text-muted-foreground mb-1 h-4 w-4" />
              <AuctionTimer auctionEndsAt={auctionEndsAt} compact />
              <p className="text-muted-foreground mt-0.5 text-[10px] font-medium tracking-wider uppercase">
                Time Left
              </p>
            </div>

            {/* Snipe indicator */}
            <div className="flex flex-col items-center justify-center px-6 py-4 sm:px-8">
              <Shield className="text-muted-foreground mb-1 h-4 w-4" />
              <SnipeIndicator count={0} max={3} />
            </div>
          </div>
        </div>

        {/* ─── Three-column layout: Charts | Bids | Activity ─── */}
        <div className="grid gap-4 lg:grid-cols-[1fr_340px_300px]">
          {/* Column 1: Charts + Market data */}
          <div className="space-y-4">
            {/* Savings hero */}
            {sim.currentLowest > 0 && sim.currentLowest < STARTING_PRICE_CENTS ? (
              <SavingsHero
                startingPriceCents={STARTING_PRICE_CENTS}
                currentLowestCents={sim.currentLowest}
                previousLowestCents={sim.previousLowest}
              />
            ) : null}

            {/* Visualization tabs */}
            <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
              <div className="border-border/30 flex items-center border-b px-1">
                {(['price', 'depth', 'trend'] as const).map((tab) => {
                  const labels = {
                    price: 'Price History',
                    depth: 'Depth Chart',
                    trend: 'Bid Trend',
                  };
                  const icons = { price: BarChart3, depth: BarChart3, trend: TrendingDown };
                  const Icon = icons[tab];
                  return (
                    <button
                      key={tab}
                      onClick={() => setVizTab(tab)}
                      className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
                        vizTab === tab
                          ? 'text-foreground border-emerald-500'
                          : 'text-muted-foreground hover:text-foreground border-transparent'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>
              <div className="p-4">
                {vizTab === 'price' && <PriceDropChart events={sim.events} />}
                {vizTab === 'depth' && (
                  <BidDepthChart
                    bids={sim.depthBuckets}
                    startingPrice={STARTING_PRICE_CENTS}
                    currentLowest={sim.currentLowest}
                  />
                )}
                {vizTab === 'trend' && <BidPriceChart bids={sim.sparklineBids} height={200} />}
              </div>
            </div>

            {/* Market Intelligence */}
            <div className="border-border/50 bg-card overflow-hidden rounded-xl border p-4">
              <MarketRangeDisplay
                marketRange={MARKET_RANGE}
                currentBidCents={sim.currentLowest > 0 ? sim.currentLowest : undefined}
              />
            </div>

            {/* Collapsible job details */}
            <button
              onClick={() => setShowJobDetails(!showJobDetails)}
              className="border-border/50 bg-card hover:bg-muted/30 flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <Calendar className="text-muted-foreground h-4 w-4" />
                <div>
                  <p className="text-sm font-medium">Job Details</p>
                  <p className="text-muted-foreground text-xs">
                    Kitchen Renovation — Austin, TX — Flexible schedule
                  </p>
                </div>
              </div>
              <ChevronDown
                className={`text-muted-foreground h-4 w-4 transition-transform ${showJobDetails ? 'rotate-180' : ''}`}
              />
            </button>
            {showJobDetails && (
              <div className="border-border/50 bg-card animate-in fade-in slide-in-from-top-2 rounded-xl border p-5 duration-200">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Complete kitchen renovation including cabinet replacement, countertop installation
                  (quartz), backsplash tiling, new plumbing fixtures, electrical updates for
                  under-cabinet lighting, and premium appliance installation. Kitchen is
                  approximately 180 sq ft with an L-shaped layout. Looking for experienced
                  contractors with kitchen renovation expertise. All materials provided — labor
                  only.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {['Kitchen', 'Renovation', 'Plumbing', 'Electrical', 'Tiling'].map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Column 2: Order Book (full-height, wide enough for names) */}
          <div className="space-y-4">
            <OrderBook jobId="demo" bids={sim.orderBookBids} startingPrice={STARTING_PRICE_CENTS} />

            {/* Top 3 providers — expanded cards */}
            {sim.orderBookBids.length >= 3 && (
              <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
                <div className="border-border/30 border-b px-4 py-2.5">
                  <h3 className="text-muted-foreground/70 text-xs font-semibold tracking-wider uppercase">
                    Top Providers
                  </h3>
                </div>
                <div className="divide-border/20 divide-y">
                  {sim.orderBookBids.slice(0, 3).map((bid, idx) => {
                    const provider = MOCK_PROVIDERS.find((p) => p.name === bid.provider_name);
                    const tierKey = (bid.trust_tier as keyof typeof TIER_COLORS) || 'new';
                    const colors = TIER_COLORS[tierKey] ?? TIER_COLORS.new;
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';

                    return (
                      <div key={bid.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="text-lg">{medal}</span>
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ${colors.bg} ${colors.text} ${colors.ring}`}
                        >
                          {provider?.initial ?? '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{bid.provider_name}</p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <Star className="h-3 w-3 text-amber-400" />
                            <span className="text-muted-foreground text-xs">
                              {String(bid.trust_score)}
                            </span>
                            <Badge variant="outline" className="px-1 py-0 text-[9px]">
                              {bid.trust_tier.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className={`text-sm font-bold tabular-nums ${idx === 0 ? 'text-emerald-500' : ''}`}
                          >
                            {fmt(bid.amount_cents)}
                          </p>
                          <p className="text-[10px] text-emerald-600 tabular-nums dark:text-emerald-400">
                            {String(
                              Math.round(
                                ((STARTING_PRICE_CENTS - bid.amount_cents) / STARTING_PRICE_CENTS) *
                                  100,
                              ),
                            )}
                            % off
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Column 3: Live Activity Feed */}
          <div className="space-y-4">
            <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
              <div className="border-border/30 flex items-center justify-between border-b px-4 py-2.5">
                <h3 className="text-muted-foreground/70 text-xs font-semibold tracking-wider uppercase">
                  Live Activity
                </h3>
                <span className="flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                  </span>
                  <span className="text-[10px] font-medium text-green-400">Live</span>
                </span>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
                <BidActivityFeed activities={sim.activities} />
              </div>
            </div>

            {/* Social proof */}
            {sim.bidCount > 0 && (
              <div className="border-border/50 rounded-xl border bg-gradient-to-br from-emerald-500/5 to-transparent p-4 text-center">
                <p className="text-3xl font-black text-emerald-500 tabular-nums">
                  {String(sim.bidCount)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  providers competing for this job
                </p>
                {savingsPct > 0 && (
                  <p className="mt-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    {String(savingsPct)}% below asking price
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
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
