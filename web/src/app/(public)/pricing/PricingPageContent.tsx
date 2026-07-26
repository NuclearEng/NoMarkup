'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Search, TrendingDown, X } from 'lucide-react';

import { FairPriceBand } from '@/components/analytics/FairPriceBand';
import { PriceHeatMap } from '@/components/maps/PriceHeatMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useFairPrice } from '@/hooks/useAnalytics';
import {
  usePricingOverview,
  usePricingByCategory,
} from '@/hooks/usePricing';
import type { PricingData, PricingOverviewCategory } from '@/hooks/usePricing';
import { formatCents } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Intersection Observer hook for scroll-triggered animations         */
/* ------------------------------------------------------------------ */
function useInView<T extends Element>(options?: IntersectionObserverInit) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.12, ...options },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [options]);

  return { ref, inView };
}

/* ------------------------------------------------------------------ */
/*  Animated counter that counts up when scrolled into view            */
/* ------------------------------------------------------------------ */
function AnimatedCounter({
  end,
  prefix = '',
  suffix = '',
  duration = 1800,
}: {
  end: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const { ref, inView } = useInView<HTMLSpanElement>();

  useEffect(() => {
    if (!inView) return;

    let startTime: number | null = null;
    let rafId: number;

    function animate(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));
      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    }

    rafId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [inView, end, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {count.toLocaleString()}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Price range bar — visual percentile strip                          */
/* ------------------------------------------------------------------ */
function PriceRangeBar({ p25, median, p75, min, max }: {
  p25: number;
  median: number;
  p75: number;
  min: number;
  max: number;
}) {
  const range = max - min || 1;
  const p25pct = ((p25 - min) / range) * 100;
  const medianPct = ((median - min) / range) * 100;
  const p75pct = ((p75 - min) / range) * 100;
  const iqrWidth = p75pct - p25pct;

  return (
    <div className="mt-3 mb-1" aria-hidden="true">
      {/* Track */}
      <div className="relative h-1.5 w-full rounded-full bg-white/[0.06]">
        {/* IQR fill (p25→p75) */}
        <div
          className="absolute h-full rounded-full bg-[var(--brand-gold)]/25"
          style={{ left: `${String(p25pct)}%`, width: `${String(iqrWidth)}%` }}
        />
        {/* Median tick */}
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-[var(--brand-gold)]"
          style={{ left: `${String(medianPct)}%` }}
        />
      </div>
      {/* Labels */}
      <div className="mt-1 flex justify-between text-[10px] text-white/30">
        <span>{formatCents(min)}</span>
        <span>{formatCents(max)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main export                                                         */
/* ------------------------------------------------------------------ */

export function PricingPageContent() {
  const [zipCode, setZipCode] = useState('');
  const [appliedZip, setAppliedZip] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PricingOverviewCategory | null>(null);

  const { data: overview, isLoading: overviewLoading, isError: overviewError } = usePricingOverview();

  const {
    data: categoryData,
    isLoading: categoryLoading,
    isError: categoryError,
  } = usePricingByCategory(
    selectedCategory?.category_slug ?? '',
    appliedZip || undefined,
  );

  function handleZipSearch() {
    const trimmed = zipCode.trim();
    setAppliedZip(trimmed);
  }

  function handleClearZip() {
    setZipCode('');
    setAppliedZip('');
  }

  const statsSection = useInView<HTMLElement>();
  const heatmapSection = useInView<HTMLElement>();

  const totalJobs = overview?.categories.reduce((acc, c) => acc + c.total_jobs, 0) ?? 0;
  const categoryCount = overview?.categories.length ?? 0;
  const avgSavingsAll = overview?.categories
    .filter((c): c is typeof c & { avg_savings_cents: number } =>
      c.avg_savings_cents != null && c.avg_savings_cents > 0,
    )
    .map((c) => c.avg_savings_cents) ?? [];
  const avgSavings =
    avgSavingsAll.length > 0
      ? Math.round(avgSavingsAll.reduce((a, b) => a + b, 0) / avgSavingsAll.length)
      : 0;

  return (
    <div className="min-h-screen bg-[#07080b]">

      {/* ============================================================ */}
      {/* HERO SECTION                                                  */}
      {/* ============================================================ */}
      <section className="relative isolate overflow-hidden bg-[#07080b] pb-10 pt-14 sm:pb-16 sm:pt-20">
        {/* Ambient gradient background */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(ellipse 70% 50% at 20% 0%, rgba(201,168,76,0.06) 0%, transparent 65%), ' +
              'radial-gradient(ellipse 50% 40% at 80% 30%, rgba(139,92,246,0.04) 0%, transparent 60%)',
          }}
        />

        <div className="relative z-[2] mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* Eyebrow pill */}
          <div className="animate-fade-in mb-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm text-white/70 glass-pill">
            <TrendingDown className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            <span>Based on real completed jobs</span>
          </div>

          {/* Headline */}
          <h1 className="animate-fade-in-up text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
            Real prices.{' '}
            <span className="gold-text">No guesswork.</span>
          </h1>

          {/* Sub-headline */}
          <p
            className="animate-fade-in-up mt-4 max-w-xl text-base leading-relaxed text-white/60 sm:mt-5 sm:text-lg"
            style={{ animationDelay: '80ms' }}
          >
            The Fair Price Index tracks what home services actually cost — pulled from completed
            jobs on NoMarkup. Search by ZIP to see local rates.
          </p>

          {/* ZIP code search bar */}
          <div
            className="animate-fade-in-up mt-8 max-w-lg"
            style={{ animationDelay: '160ms' }}
          >
            <div className="glass glass-highlight rounded-2xl p-4 sm:p-5">
              <label htmlFor="zip-search" className="mb-3 block text-sm font-medium text-white/70">
                Filter by ZIP code
              </label>
              <div className="flex gap-2.5">
                <div className="relative flex-1">
                  <MapPin
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
                    aria-hidden="true"
                  />
                  <Input
                    id="zip-search"
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter ZIP code…"
                    value={zipCode}
                    onChange={(e) => { setZipCode(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleZipSearch();
                    }}
                    autoComplete="postal-code"
                    className="min-h-[44px] w-full border-white/10 bg-white/[0.05] pl-9 text-white placeholder:text-white/30 focus-visible:border-[var(--brand-gold)]/40 focus-visible:ring-[var(--brand-gold)]/20"
                  />
                </div>
                <Button
                  onClick={handleZipSearch}
                  className="glass-cta-gold min-h-[44px] gap-2 rounded-xl px-5 font-semibold"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Search
                </Button>
                {appliedZip ? (
                  <Button
                    variant="outline"
                    onClick={handleClearZip}
                    aria-label="Clear ZIP filter"
                    className="min-h-[44px] rounded-xl border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
              {appliedZip ? (
                <p className="mt-2.5 text-sm text-white/50">
                  Showing prices for ZIP code{' '}
                  <span className="font-semibold text-[var(--brand-gold)]">{appliedZip}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* STATS BAR                                                     */}
      {/* ============================================================ */}
      <section
        ref={statsSection.ref}
        className="border-y border-white/[0.05] bg-[#0c0f18] py-8 sm:py-12"
        aria-label="Pricing index statistics"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6">
            {/* Stat 1 — Jobs tracked */}
            <div
              className={`glass-stat-card glass-highlight flex flex-col items-center px-3 py-5 text-center transition-all duration-700 sm:px-6 sm:py-8 ${statsSection.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
              style={{ transitionDelay: '0ms' }}
            >
              <div className="relative z-[3] text-2xl font-black tracking-tight sm:text-4xl" style={{ color: 'hsl(220,70%,55%)' }}>
                {overviewLoading ? (
                  <Skeleton className="h-8 w-16 rounded" />
                ) : (
                  <AnimatedCounter end={totalJobs} suffix="+" />
                )}
              </div>
              <p className="text-muted-foreground relative z-[3] mt-1 text-[10px] font-medium uppercase tracking-wide sm:mt-2 sm:text-xs">
                Jobs Tracked
              </p>
            </div>

            {/* Stat 2 — Avg savings */}
            <div
              className={`glass-stat-card glass-highlight flex flex-col items-center px-3 py-5 text-center transition-all duration-700 sm:px-6 sm:py-8 ${statsSection.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
              style={{ transitionDelay: '120ms' }}
            >
              <div className="relative z-[3] text-2xl font-black tracking-tight sm:text-4xl" style={{ color: 'hsl(142,71%,45%)' }}>
                {overviewLoading ? (
                  <Skeleton className="h-8 w-20 rounded" />
                ) : avgSavings > 0 ? (
                  <AnimatedCounter end={Math.round(avgSavings / 100)} prefix="$" />
                ) : (
                  <span>—</span>
                )}
              </div>
              <p className="text-muted-foreground relative z-[3] mt-1 text-[10px] font-medium uppercase tracking-wide sm:mt-2 sm:text-xs">
                Avg. Savings
              </p>
            </div>

            {/* Stat 3 — Categories */}
            <div
              className={`glass-stat-card glass-highlight flex flex-col items-center px-3 py-5 text-center transition-all duration-700 sm:px-6 sm:py-8 ${statsSection.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
              style={{ transitionDelay: '240ms' }}
            >
              <div className="relative z-[3] text-2xl font-black tracking-tight sm:text-4xl" style={{ color: 'hsl(38,92%,50%)' }}>
                {overviewLoading ? (
                  <Skeleton className="h-8 w-10 rounded" />
                ) : (
                  <AnimatedCounter end={categoryCount} />
                )}
              </div>
              <p className="text-muted-foreground relative z-[3] mt-1 text-[10px] font-medium uppercase tracking-wide sm:mt-2 sm:text-xs">
                Categories
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* MAIN CONTENT                                                  */}
      {/* ============================================================ */}
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">

        {/* ── Heat map section ─────────────────────────────────────── */}
        <section
          ref={heatmapSection.ref}
          aria-labelledby="heatmap-heading"
          className={`mb-12 transition-all duration-700 ${heatmapSection.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
        >
          {/* Section header */}
          <div className="mb-5 flex items-center gap-3">
            <div className="glass-pill inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-medium text-white/60">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                aria-hidden="true"
              />
              Live
            </div>
            <h2
              id="heatmap-heading"
              className="text-lg font-bold text-white sm:text-xl"
            >
              Price heat map
            </h2>
          </div>

          <div className="glass glass-highlight overflow-hidden rounded-2xl">
            <PriceHeatMap
              categorySlug={selectedCategory?.category_slug}
              className="h-[380px] sm:h-[440px]"
            />
          </div>
        </section>

        {/* ── Category overview or detail ──────────────────────────── */}
        {selectedCategory ? (
          <CategoryDetail
            category={selectedCategory}
            data={categoryData?.prices ?? []}
            isLoading={categoryLoading}
            isError={categoryError}
            appliedZip={appliedZip}
            onBack={() => { setSelectedCategory(null); }}
          />
        ) : (
          <CategoryOverview
            categories={overview?.categories ?? []}
            isLoading={overviewLoading}
            isError={overviewError}
            onSelect={setSelectedCategory}
          />
        )}

        {/* ── CTA section ─────────────────────────────────────────── */}
        <section
          className="mt-16 sm:mt-20"
          aria-labelledby="pricing-cta-heading"
        >
          <div className="glass glass-elevated glass-highlight glass-tinted-gold glass-specular-anim rounded-2xl p-8 text-center sm:p-14">
            <h2
              id="pricing-cta-heading"
              className="relative z-[3] text-2xl font-black tracking-tight text-white sm:text-3xl"
            >
              Get these prices for your next project
            </h2>
            <p className="text-muted-foreground relative z-[3] mx-auto mt-3 max-w-lg text-base sm:mt-4 sm:text-lg">
              Post your job on NoMarkup and let providers compete for your business. Our
              reverse-auction model means you always get a fair price.
            </p>
            <div className="relative z-[3] mt-8 sm:mt-10">
              <Button
                size="lg"
                className="glass-cta-gold min-h-[52px] w-full rounded-xl px-10 text-base font-semibold sm:w-auto"
                asChild
              >
                <Link href="/register">
                  Post Your Job — It&apos;s Free
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category overview grid                                             */
/* ------------------------------------------------------------------ */

function CategoryOverview({
  categories,
  isLoading,
  isError,
  onSelect,
}: {
  categories: PricingOverviewCategory[];
  isLoading: boolean;
  isError: boolean;
  onSelect: (cat: PricingOverviewCategory) => void;
}) {
  const section = useInView<HTMLElement>();

  if (isLoading) {
    return (
      <section aria-label="Loading service categories">
        <div className="mb-6 h-7 w-40">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={`skeleton-${String(i)}`}
              className="h-44 rounded-2xl border border-white/[0.06] bg-white/[0.03]"
            />
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <div className="glass glass-highlight rounded-2xl p-8 text-center">
        <p className="text-destructive font-medium">
          Failed to load pricing data. Please try again.
        </p>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="glass-empty-state rounded-2xl p-10 text-center">
        <p className="text-white/50">
          No pricing data available yet. Check back soon as more jobs are completed.
        </p>
      </div>
    );
  }

  return (
    <section
      ref={section.ref}
      aria-labelledby="categories-heading"
    >
      {/* Section header */}
      <div
        className={`mb-6 flex items-center justify-between transition-all duration-700 ${section.inView ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
      >
        <h2 id="categories-heading" className="text-xl font-bold text-white sm:text-2xl">
          Service categories
        </h2>
        <span className="text-sm text-white/40">
          {String(categories.length)} categories
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat, i) => (
          <button
            key={cat.category_slug}
            type="button"
            onClick={() => { onSelect(cat); }}
            className={`group text-left transition-all duration-700 ${section.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            style={{ transitionDelay: section.inView ? `${String(80 + i * 60)}ms` : '0ms' }}
            aria-label={`View pricing for ${cat.category_name}`}
          >
            <div className="glass glass-interactive glass-highlight h-full rounded-2xl p-5 transition-all hover:border-[var(--brand-gold)]/30 sm:p-6">
              {/* Category name */}
              <p className="relative z-[3] text-base font-bold text-white group-hover:text-white sm:text-lg">
                {cat.category_name}
              </p>

              {/* Median price — gold accent */}
              <p className="relative z-[3] mt-3 text-3xl font-black tabular-nums tracking-tight sm:text-4xl"
                style={{
                  background: 'linear-gradient(135deg, var(--brand-gold-dim), var(--brand-gold-bright))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {formatCents(cat.avg_median_cents)}
              </p>
              <p className="relative z-[3] text-xs text-white/40">
                median price
              </p>

              {/* Divider */}
              <div className="glass-divider relative z-[3] my-4" aria-hidden="true" />

              {/* Meta badges */}
              <div className="relative z-[3] flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-white/60 ring-1 ring-white/[0.08]">
                  {String(cat.total_jobs)} job{cat.total_jobs !== 1 ? 's' : ''}
                </span>
                {cat.avg_savings_cents != null && cat.avg_savings_cents > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                    Avg. {formatCents(cat.avg_savings_cents)} saved
                  </span>
                ) : null}
              </div>

              {/* Arrow hint on hover */}
              <div className="relative z-[3] mt-4 flex items-center gap-1 text-xs font-medium text-white/30 transition-colors group-hover:text-[var(--brand-gold)]/70">
                View breakdown
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Category detail view                                               */
/* ------------------------------------------------------------------ */

function CategoryDetail({
  category,
  data,
  isLoading,
  isError,
  appliedZip,
  onBack,
}: {
  category: PricingOverviewCategory;
  data: PricingData[];
  isLoading: boolean;
  isError: boolean;
  appliedZip: string;
  onBack: () => void;
}) {
  const section = useInView<HTMLElement>();

  return (
    <section ref={section.ref} aria-labelledby="detail-heading">
      {/* Back button */}
      <Button
        variant="outline"
        onClick={onBack}
        className="mb-7 min-h-[44px] gap-2 rounded-xl border-white/10 bg-white/[0.03] text-white/70 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All categories
      </Button>

      {/* Detail header */}
      <div
        className={`mb-8 transition-all duration-700 ${section.inView ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              id="detail-heading"
              className="text-2xl font-black tracking-tight text-white sm:text-3xl"
            >
              {category.category_name}
              <span className="gold-text"> pricing</span>
            </h2>
            <p className="mt-1.5 text-sm text-white/50">
              Based on{' '}
              <span className="font-semibold text-white/70">{String(category.total_jobs)}</span>{' '}
              completed job{category.total_jobs !== 1 ? 's' : ''} on NoMarkup
              {appliedZip ? (
                <>
                  {' '}in{' '}
                  <span className="font-semibold text-[var(--brand-gold)]">{appliedZip}</span>
                </>
              ) : ''}
            </p>
          </div>

          {/* Overall median callout */}
          <div className="glass glass-highlight rounded-xl px-5 py-3 text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-white/40">Median</p>
            <p
              className="mt-0.5 text-2xl font-black tabular-nums"
              style={{
                background: 'linear-gradient(135deg, var(--brand-gold-dim), var(--brand-gold-bright))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {formatCents(category.avg_median_cents)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={`detail-skeleton-${String(i)}`}
              className="h-60 rounded-2xl border border-white/[0.06] bg-white/[0.03]"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="glass glass-highlight rounded-2xl p-8 text-center">
          <p className="text-destructive font-medium">
            Failed to load pricing breakdown. Please try again.
          </p>
        </div>
      ) : data.length === 0 ? (
        <div className="glass-empty-state rounded-2xl p-10 text-center">
          <p className="text-white/50">
            {appliedZip
              ? `No pricing data for ZIP code ${appliedZip}. Try a different ZIP or clear the filter.`
              : 'No pricing data available for this category yet.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((row, i) => (
            <PriceDetailCard
              key={`${row.category_slug}-${row.zip_code}`}
              row={row}
              index={i}
              parentInView={section.inView}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual price detail card                                        */
/* ------------------------------------------------------------------ */

function PriceDetailCard({
  row,
  index,
  parentInView,
}: {
  row: PricingData;
  index: number;
  parentInView: boolean;
}) {
  // Fair-Price engine read for this (category × zip) cell. Augments the static
  // materialized-view medians below with a confidence-scored band that handles
  // sparse data gracefully. Degrades to a "not enough data" note on miss.
  const {
    data: fairPrice,
    isLoading: fairPriceLoading,
    isError: fairPriceError,
  } = useFairPrice({ categorySlug: row.category_slug, zip: row.zip_code });

  return (
    <div
      className={`glass glass-highlight glass-specular-anim rounded-2xl p-5 transition-all duration-700 ${parentInView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
      style={{ transitionDelay: parentInView ? `${String(60 + index * 70)}ms` : '0ms' }}
    >
      {/* Card header */}
      <div className="relative z-[3] mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
          <p className="font-bold text-white">{row.zip_code}</p>
        </div>
        <span className="inline-flex items-center rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-white/50 ring-1 ring-white/[0.07]">
          {String(row.completed_jobs)} job{row.completed_jobs !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Fair-Price band — confidence-scored estimate (replaces the bare
          median hero with the engine's robust estimate + band + confidence). */}
      <div className="relative z-[3] mb-4">
        <FairPriceBand
          fairPrice={fairPrice}
          isLoading={fairPriceLoading}
          isError={fairPriceError}
          title="Fair price"
        />
      </div>

      {/* Static materialized-view percentile detail, retained as the
          breakdown beneath the live band. */}
      <div className="relative z-[3]">
        <p className="text-xs font-medium uppercase tracking-wide text-white/35">
          Median price
        </p>
        <p
          className="mt-0.5 text-2xl font-black tabular-nums"
          style={{
            background: 'linear-gradient(135deg, var(--brand-gold-dim), var(--brand-gold-bright))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {formatCents(row.median_price_cents)}
        </p>
      </div>

      {/* Visual price range bar */}
      <div className="relative z-[3]">
        <PriceRangeBar
          p25={row.p25_price_cents}
          median={row.median_price_cents}
          p75={row.p75_price_cents}
          min={row.min_price_cents}
          max={row.max_price_cents}
        />
      </div>

      {/* Divider */}
      <div className="glass-divider relative z-[3] my-4" aria-hidden="true" />

      {/* Breakdown table */}
      <div className="relative z-[3] space-y-2 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-white/40">Budget-friendly (25th pct)</span>
          <span className="tabular-nums font-medium text-white/75">
            {formatCents(row.p25_price_cents)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-white/40">Typical (50th pct)</span>
          <span className="tabular-nums font-semibold text-white">
            {formatCents(row.median_price_cents)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-white/40">Premium (75th pct)</span>
          <span className="tabular-nums font-medium text-white/75">
            {formatCents(row.p75_price_cents)}
          </span>
        </div>

        <div className="glass-divider my-3" aria-hidden="true" />

        <div className="flex items-baseline justify-between">
          <span className="text-white/40">Range</span>
          <span className="tabular-nums font-medium text-white/60">
            {formatCents(row.min_price_cents)}&nbsp;&ndash;&nbsp;{formatCents(row.max_price_cents)}
          </span>
        </div>

        {row.avg_savings_cents != null && row.avg_savings_cents > 0 ? (
          <div className="flex items-baseline justify-between">
            <span className="text-white/40">Avg. savings vs. budget</span>
            <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-emerald-400">
              <TrendingDown className="h-3 w-3" aria-hidden="true" />
              {formatCents(row.avg_savings_cents)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
