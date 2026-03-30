'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Megaphone,
  Users,
  BadgeCheck,
  ArrowRight,
  Droplets,
  Zap,
  TreePine,
  Sparkles,
  Paintbrush,
  Thermometer,
  Home,
  Truck,
  TrendingDown,
  Shield,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MarketTickerStrip } from '@/components/landing/MarketTickerStrip';
import { GradientMesh } from '@/components/landing/GradientMesh';
import { AuctionDemo } from '@/components/landing/AuctionDemo';

// ---------------------------------------------------------------------------
// Intersection Observer hook for scroll-triggered animations
// ---------------------------------------------------------------------------
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
      { threshold: 0.15, ...options },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [options]);

  return { ref, inView };
}

// ---------------------------------------------------------------------------
// Animated counter that counts up when scrolled into view
// ---------------------------------------------------------------------------
function AnimatedCounter({
  end,
  prefix = '',
  suffix = '',
  duration = 2000,
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
      // Ease-out cubic for a satisfying deceleration
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

// ---------------------------------------------------------------------------
// Micro sparkline SVG for stat cards
// ---------------------------------------------------------------------------
function MicroSparkline({ data, color }: { data: readonly number[]; color: string }) {
  const { ref, inView } = useInView<SVGSVGElement>();
  const width = 60;
  const height = 20;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${String(x)},${String(y)}`;
    })
    .join(' ');

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="mt-1"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={inView ? 'sparkline-path' : ''}
        opacity="0.6"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Ticker data (mock marketplace activity)
// ---------------------------------------------------------------------------
const TICKER_ITEMS = [
  {
    category: 'Plumbing',
    location: 'Austin',
    currentPrice: 34000,
    originalPrice: 80000,
    status: 'completed' as const,
  },
  {
    category: 'House Cleaning',
    location: 'SF',
    currentPrice: 8900,
    bidCount: 12,
    status: 'active' as const,
  },
  {
    category: 'Lawn Care',
    location: 'Denver',
    currentPrice: 15500,
    timeRemaining: 'Ending in 2h',
    status: 'ending-soon' as const,
  },
  {
    category: 'Painting',
    location: 'Seattle',
    currentPrice: 120000,
    originalPrice: 185000,
    status: 'completed' as const,
  },
  {
    category: 'Electrical',
    location: 'Chicago',
    currentPrice: 42000,
    bidCount: 8,
    status: 'active' as const,
  },
  {
    category: 'Roofing',
    location: 'Portland',
    currentPrice: 680000,
    originalPrice: 950000,
    status: 'completed' as const,
  },
  {
    category: 'HVAC Repair',
    location: 'Miami',
    currentPrice: 28000,
    timeRemaining: 'Ending in 45m',
    status: 'ending-soon' as const,
  },
  {
    category: 'Moving',
    location: 'Dallas',
    currentPrice: 95000,
    bidCount: 15,
    status: 'active' as const,
  },
  {
    category: 'Tree Removal',
    location: 'Atlanta',
    currentPrice: 45000,
    originalPrice: 72000,
    status: 'completed' as const,
  },
  {
    category: 'Carpet Cleaning',
    location: 'Phoenix',
    currentPrice: 19500,
    bidCount: 6,
    status: 'active' as const,
  },
] as const;

// ---------------------------------------------------------------------------
// Category data
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { name: 'Plumbing', icon: Droplets, providers: 1240 },
  { name: 'Electrical', icon: Zap, providers: 980 },
  { name: 'Landscaping', icon: TreePine, providers: 1560 },
  { name: 'Cleaning', icon: Sparkles, providers: 2100 },
  { name: 'Painting', icon: Paintbrush, providers: 870 },
  { name: 'HVAC', icon: Thermometer, providers: 640 },
  { name: 'Roofing', icon: Home, providers: 520 },
  { name: 'Moving', icon: Truck, providers: 730 },
] as const;

// ---------------------------------------------------------------------------
// Stats data with sparklines
// ---------------------------------------------------------------------------
const STATS = [
  {
    value: 10847,
    prefix: '',
    suffix: '+',
    label: 'Jobs Posted',
    sparkline: [20, 35, 28, 45, 52, 48, 65, 72, 68, 85, 92, 100] as const,
    color: 'hsl(220, 70%, 55%)',
  },
  {
    value: 47200,
    prefix: '',
    suffix: '+',
    label: 'Bids Placed',
    sparkline: [15, 22, 30, 28, 42, 55, 50, 68, 75, 82, 90, 100] as const,
    color: 'hsl(142, 71%, 45%)',
  },
  {
    value: 2300000,
    prefix: '$',
    suffix: '',
    label: 'Saved by Customers',
    sparkline: [10, 18, 25, 35, 40, 48, 55, 62, 70, 80, 90, 100] as const,
    color: 'hsl(38, 92%, 50%)',
    display: '$2.3M',
  },
] as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function LandingPage() {
  const howItWorks = useInView<HTMLElement>();
  const statsSection = useInView<HTMLElement>();
  const categories = useInView<HTMLElement>();

  return (
    <>
      {/* ================================================================= */}
      {/* HERO — Dark immersive cinematic section                            */}
      {/* ================================================================= */}
      <section className="relative isolate overflow-hidden bg-[#070b14]">
        {/* Animated gradient mesh background */}
        <GradientMesh />

        {/* Vignette overlay — cinematic dark corners */}
        <div
          className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
          aria-hidden="true"
        />

        {/* Market ticker strip at top */}
        <div className="relative z-[2]">
          <MarketTickerStrip items={[...TICKER_ITEMS]} speed="normal" />
        </div>

        <div className="relative z-[2] mx-auto max-w-7xl px-4 pt-20 pb-24 sm:px-6 sm:pt-24 sm:pb-32 lg:px-8 lg:pt-28 lg:pb-36">
          <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
            {/* Left column — text content */}
            <div className="mx-auto max-w-xl text-center lg:mx-0 lg:text-left">
              {/* Eyebrow badge */}
              <div className="animate-fade-in mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-sm text-white/50 backdrop-blur-sm">
                <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                <span>Providers compete. You save.</span>
              </div>

              {/* Main headline — cinematic scale with gradient text */}
              <h1 className="animate-fade-in-up text-5xl font-black tracking-tight text-white sm:text-6xl lg:text-7xl">
                Home services at{' '}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      'linear-gradient(135deg, #f0d97a, #c9a84c, #a08839, #c9a84c, #f0d97a)',
                    backgroundSize: '300% 300%',
                    animation: 'gradient-shift 5s ease infinite',
                    letterSpacing: '-0.02em',
                  }}
                >
                  market prices
                </span>
              </h1>

              {/* Sub-headline — more breathing room */}
              <p
                className="animate-fade-in-up mt-8 text-lg leading-relaxed text-white/55 sm:text-xl sm:leading-relaxed"
                style={{ animationDelay: '100ms' }}
              >
                Post what you need, then watch qualified providers compete for your business. A
                reverse auction means the price goes{' '}
                <span className="font-semibold text-white/90">down</span>, not up.
              </p>

              {/* CTAs — glow effect on primary */}
              <div
                className="animate-fade-in-up mt-12 flex flex-col items-center gap-4 sm:flex-row lg:justify-start"
                style={{ animationDelay: '200ms' }}
              >
                <Button
                  size="lg"
                  className="cta-glow-btn min-h-[52px] rounded-xl px-9 text-base font-semibold"
                  style={{
                    background: 'linear-gradient(135deg, #d4b55a, #c9a84c, #a08839)',
                    color: '#fff',
                    boxShadow: '0 0 16px rgba(201,168,76,0.25), 0 4px 12px rgba(0,0,0,0.3)',
                  }}
                  asChild
                >
                  <Link href="/register">
                    Get started
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="min-h-[52px] rounded-xl border-white/[0.1] bg-white/[0.03] px-9 text-base text-white/70 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                  asChild
                >
                  <Link href="/jobs">Browse jobs</Link>
                </Button>
              </div>

              {/* Social proof — avatar stack + star rating + stats */}
              <div
                className="animate-fade-in-up mt-12 flex flex-wrap items-center gap-6 lg:justify-start"
                style={{ animationDelay: '350ms' }}
              >
                {/* Avatar stack */}
                <div className="flex items-center gap-3">
                  <div className="avatar-stack flex">
                    {['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'].map((color, i) => (
                      <div
                        key={color}
                        className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#070b14] text-[10px] font-bold text-white"
                        style={{ background: color, zIndex: 5 - i }}
                        aria-hidden="true"
                      >
                        {['S', 'M', 'J', 'A', 'R'][i]}
                      </div>
                    ))}
                  </div>
                  <span className="text-sm text-white/45">10,000+ jobs completed</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="flex gap-0.5" aria-label="4.9 out of 5 stars">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg
                        key={star}
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill={star <= 4 ? '#eab308' : '#eab308'}
                        opacity={star === 5 ? 0.7 : 1}
                        aria-hidden="true"
                      >
                        <path d="M8 0l2.2 5.5L16 6.3l-4 3.7 1 5.5L8 12.8 2.9 15.5l1-5.5-4-3.7 5.9-.8z" />
                      </svg>
                    ))}
                  </div>
                  <span className="text-sm font-medium text-white/50">4.9</span>
                </div>

                <div className="flex items-center gap-1.5 text-sm text-white/45">
                  <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Avg. 23% savings</span>
                </div>
              </div>
            </div>

            {/* Right column — Auction demo animation */}
            <div
              className="animate-fade-in-up mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none"
              style={{ animationDelay: '300ms' }}
            >
              <AuctionDemo />
            </div>
          </div>
        </div>

        {/* Gradient bridge from hero to stats — smooth fade */}
        <div className="hero-stats-bridge relative z-[2] h-20 sm:h-24" aria-hidden="true" />
      </section>

      {/* ================================================================= */}
      {/* HERO STATS BAR — Animated counters with sparklines                 */}
      {/* ================================================================= */}
      <section
        ref={statsSection.ref}
        className="bg-card border-b py-14 sm:py-16"
        aria-label="Platform statistics"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8">
            {STATS.map((stat, i) => (
              <div
                key={stat.label}
                className={`flex flex-col items-center text-center transition-all duration-700 ${statsSection.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                style={{ transitionDelay: `${String(i * 120)}ms` }}
              >
                <p
                  className="text-4xl font-black tracking-tight sm:text-5xl"
                  style={{ color: stat.color }}
                >
                  {'display' in stat && stat.display ? (
                    stat.display
                  ) : (
                    <AnimatedCounter end={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
                  )}
                </p>
                <p className="text-muted-foreground mt-2 text-sm font-medium tracking-wide uppercase">
                  {stat.label}
                </p>
                {statsSection.inView ? (
                  <MicroSparkline data={stat.sparkline} color={stat.color} />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* HOW IT WORKS                                                      */}
      {/* ================================================================= */}
      <section
        ref={howItWorks.ref}
        className="bg-muted/30 border-t py-28 sm:py-36"
        aria-labelledby="how-it-works-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="how-it-works-heading"
              className={`text-3xl font-black tracking-tight transition-all duration-700 sm:text-4xl ${howItWorks.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              How it works
            </h2>
            <p
              className={`text-muted-foreground mt-5 text-lg transition-all delay-100 duration-700 ${howItWorks.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              Three simple steps to better prices on home services.
            </p>
          </div>

          <div className="mx-auto mt-20 grid max-w-5xl gap-8 sm:grid-cols-3 sm:gap-14">
            {[
              {
                step: 1,
                icon: Megaphone,
                title: 'Post your job',
                description:
                  'Describe the work you need done. Add photos, set your budget range, and pick a timeline.',
              },
              {
                step: 2,
                icon: Users,
                title: 'Providers compete',
                description:
                  'Qualified, verified providers see your job and bid against each other in a live reverse auction.',
              },
              {
                step: 3,
                icon: BadgeCheck,
                title: 'Pick the best deal',
                description:
                  'Compare bids, read reviews, and choose the provider that fits your budget and standards.',
              },
            ].map((item, i) => (
              <div
                key={item.step}
                className={`step-card-glow bg-card relative rounded-2xl border p-8 text-center transition-all duration-700 ${howItWorks.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                style={{ transitionDelay: `${String(200 + i * 150)}ms` }}
              >
                {/* Large step number — gradient gold */}
                <div className="gold-text mx-auto text-5xl font-black" aria-hidden="true">
                  {String(item.step)}
                </div>

                {/* Icon */}
                <div className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-gold)]/10 ring-1 ring-[var(--brand-gold)]/15">
                  <item.icon className="h-7 w-7" style={{ color: 'var(--brand-gold)' }} />
                </div>

                <h3 className="mt-5 text-lg font-bold">{item.title}</h3>
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* TESTIMONIAL + TRUST                                               */}
      {/* ================================================================= */}
      <section className="py-28 sm:py-36" aria-labelledby="trust-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Testimonial */}
          <div className="mx-auto max-w-2xl text-center">
            {/* Decorative quote mark */}
            <div
              className="gold-text mx-auto mb-6 text-6xl leading-none font-black"
              aria-hidden="true"
            >
              &ldquo;
            </div>
            <blockquote>
              <p className="text-foreground/70 text-lg leading-relaxed sm:text-xl">
                I posted a bathroom remodel expecting to pay $8,000. Four providers competed and I
                picked an incredible contractor for{' '}
                <span className="gold-text font-bold">$5,400</span>. Same quality, 32% less.
                NoMarkup changed how I hire.
              </p>
              <footer className="mt-8">
                <p className="text-lg font-bold">Sarah M.</p>
                <p className="text-muted-foreground mt-1 text-sm">Homeowner in Austin, TX</p>
              </footer>
            </blockquote>
          </div>

          {/* Trust signals */}
          <div className="text-muted-foreground mx-auto mt-14 flex max-w-lg flex-wrap items-center justify-center gap-8 text-sm">
            <span className="flex items-center gap-2">
              <Shield className="h-4 w-4" style={{ color: 'var(--brand-gold)' }} />
              Payment protection
            </span>
            <span className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4" style={{ color: 'var(--brand-gold)' }} />
              Verified providers
            </span>
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4" style={{ color: 'var(--brand-gold)' }} />
              Free to post
            </span>
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* CATEGORIES                                                        */}
      {/* ================================================================= */}
      <section
        ref={categories.ref}
        className="bg-muted/30 border-t py-28 sm:py-36"
        aria-labelledby="categories-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="categories-heading"
              className={`text-3xl font-black tracking-tight transition-all duration-700 sm:text-4xl ${categories.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              Popular categories
            </h2>
            <p
              className={`text-muted-foreground mt-5 text-lg transition-all delay-100 duration-700 ${categories.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              Whatever the project, there are providers ready to compete for it.
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:gap-6">
            {CATEGORIES.map((cat, i) => (
              <Link
                key={cat.name}
                href="/jobs"
                className={`group bg-card flex flex-col items-center gap-3 rounded-2xl border p-7 text-center transition-all duration-300 hover:-translate-y-1.5 hover:border-[var(--brand-gold)]/20 hover:shadow-[var(--brand-gold)]/5 hover:shadow-xl ${categories.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
                style={{
                  transitionDelay: categories.inView ? `${String(200 + i * 75)}ms` : '0ms',
                }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-gold)]/[0.08] ring-1 ring-[var(--brand-gold)]/10 transition-colors group-hover:bg-[var(--brand-gold)]/[0.14]">
                  <cat.icon
                    className="animate-icon-hover h-6 w-6 transition-transform"
                    style={{ color: 'var(--brand-gold)' }}
                  />
                </div>
                <div>
                  <p className="font-bold">{cat.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {cat.providers.toLocaleString()} providers
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* FINAL CTA                                                         */}
      {/* ================================================================= */}
      <section className="py-28 sm:py-36" aria-labelledby="cta-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="cta-heading" className="text-3xl font-black tracking-tight sm:text-4xl">
              Ready to save?
            </h2>
            <p className="text-muted-foreground mt-5 text-lg">
              Join thousands of homeowners who stopped overpaying for quality service.
            </p>
            <div className="mt-12">
              <Button
                size="lg"
                className="cta-glow-btn min-h-[52px] rounded-xl px-10 text-base font-semibold"
                style={{
                  background: 'linear-gradient(135deg, #d4b55a, #c9a84c, #a08839)',
                  color: '#fff',
                  boxShadow: '0 0 16px rgba(201,168,76,0.2), 0 4px 12px rgba(0,0,0,0.15)',
                }}
                asChild
              >
                <Link href="/register">
                  Post your first job &mdash; it&apos;s free
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
