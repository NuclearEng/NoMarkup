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
      {/* HERO — Dark immersive section with gradient mesh background        */}
      {/* ================================================================= */}
      <section className="relative isolate overflow-hidden bg-[#070b14]">
        {/* Animated gradient mesh background */}
        <GradientMesh />

        {/* Market ticker strip at top */}
        <MarketTickerStrip items={[...TICKER_ITEMS]} speed="normal" />

        <div className="mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-6 sm:pt-20 sm:pb-28 lg:px-8 lg:pt-24 lg:pb-32">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Left column — text content */}
            <div className="mx-auto max-w-xl text-center lg:mx-0 lg:text-left">
              {/* Eyebrow badge */}
              <div className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm text-white/60 backdrop-blur-sm">
                <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                <span>Providers compete. You save.</span>
              </div>

              {/* Main headline */}
              <h1 className="animate-fade-in-up text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Home services at{' '}
                <span
                  className="bg-gradient-to-r bg-clip-text text-transparent"
                  style={{
                    backgroundImage: 'linear-gradient(135deg, #e4c566, #c9a84c, #e4c566)',
                    backgroundSize: '200% 200%',
                    animation: 'gradient-shift 4s ease infinite',
                  }}
                >
                  market prices
                </span>
              </h1>

              {/* Sub-headline */}
              <p
                className="animate-fade-in-up mt-6 text-lg leading-relaxed text-white/60 sm:text-xl"
                style={{ animationDelay: '100ms' }}
              >
                Post what you need, then watch qualified providers compete for your business. A
                reverse auction means the price goes{' '}
                <span className="font-semibold text-white/90">down</span>, not up.
              </p>

              {/* CTAs */}
              <div
                className="animate-fade-in-up mt-10 flex flex-col items-center gap-4 sm:flex-row lg:justify-start"
                style={{ animationDelay: '200ms' }}
              >
                <Button
                  size="lg"
                  className="min-h-[48px] px-8 text-base"
                  style={{
                    background: 'linear-gradient(135deg, #c9a84c, #a08839)',
                    color: '#fff',
                  }}
                  asChild
                >
                  <Link href="/register">
                    Get started
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="min-h-[48px] border-white/15 bg-white/[0.04] px-8 text-base text-white/80 hover:bg-white/[0.08] hover:text-white"
                  asChild
                >
                  <Link href="/jobs">Browse jobs</Link>
                </Button>
              </div>

              {/* Social proof micro-stats */}
              <div
                className="animate-fade-in-up mt-10 flex flex-wrap items-center gap-6 lg:justify-start"
                style={{ animationDelay: '350ms' }}
              >
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <TrendingDown className="h-4 w-4 text-emerald-400" />
                  <span>Avg. 23% savings</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <BadgeCheck className="h-4 w-4 text-blue-400" />
                  <span>10,000+ jobs completed</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="#eab308" aria-hidden="true">
                    <path d="M8 0l2.2 5.5L16 6.3l-4 3.7 1 5.5L8 12.8 2.9 15.5l1-5.5-4-3.7 5.9-.8z" />
                  </svg>
                  <span>4.9 average rating</span>
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
      </section>

      {/* ================================================================= */}
      {/* HERO STATS BAR — Animated counters with sparklines                 */}
      {/* ================================================================= */}
      <section
        ref={statsSection.ref}
        className="bg-card border-b py-10 sm:py-12"
        aria-label="Platform statistics"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STATS.map((stat, i) => (
              <div
                key={stat.label}
                className={`flex flex-col items-center text-center transition-all duration-700 ${statsSection.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                style={{ transitionDelay: `${String(i * 120)}ms` }}
              >
                <p className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {'display' in stat && stat.display ? (
                    stat.display
                  ) : (
                    <AnimatedCounter end={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
                  )}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">{stat.label}</p>
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
        className="bg-muted/30 border-t py-24 sm:py-32"
        aria-labelledby="how-it-works-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="how-it-works-heading"
              className={`text-3xl font-bold tracking-tight transition-all duration-700 sm:text-4xl ${howItWorks.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              How it works
            </h2>
            <p
              className={`text-muted-foreground mt-4 text-lg transition-all delay-100 duration-700 ${howItWorks.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              Three simple steps to better prices on home services.
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl gap-8 sm:grid-cols-3 sm:gap-12">
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
                className={`relative text-center transition-all duration-700 ${howItWorks.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                style={{ transitionDelay: `${String(200 + i * 150)}ms` }}
              >
                {/* Step number + icon */}
                <div className="bg-primary/5 ring-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ring-1">
                  <item.icon className="text-primary h-7 w-7" />
                </div>
                <span className="bg-primary text-primary-foreground mt-4 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold">
                  Step {item.step}
                </span>
                <h3 className="mt-3 text-lg font-semibold">{item.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
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
      <section className="py-24 sm:py-32" aria-labelledby="trust-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Testimonial */}
          <div className="mx-auto max-w-2xl text-center">
            <blockquote>
              <p className="text-muted-foreground text-lg leading-relaxed sm:text-xl">
                &ldquo;I posted a bathroom remodel expecting to pay $8,000. Four providers competed
                and I picked an incredible contractor for $5,400. Same quality, 32% less. NoMarkup
                changed how I hire.&rdquo;
              </p>
              <footer className="mt-6">
                <p className="font-semibold">Sarah M.</p>
                <p className="text-muted-foreground text-sm">Homeowner in Austin, TX</p>
              </footer>
            </blockquote>
          </div>

          {/* Trust signals */}
          <div className="text-muted-foreground mx-auto mt-12 flex max-w-lg flex-wrap items-center justify-center gap-6 text-sm">
            <span className="flex items-center gap-1.5">
              <Shield className="h-4 w-4" />
              Payment protection
            </span>
            <span className="flex items-center gap-1.5">
              <BadgeCheck className="h-4 w-4" />
              Verified providers
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
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
        className="bg-muted/30 border-t py-24 sm:py-32"
        aria-labelledby="categories-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="categories-heading"
              className={`text-3xl font-bold tracking-tight transition-all duration-700 sm:text-4xl ${categories.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              Popular categories
            </h2>
            <p
              className={`text-muted-foreground mt-4 text-lg transition-all delay-100 duration-700 ${categories.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              Whatever the project, there are providers ready to compete for it.
            </p>
          </div>

          <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:gap-5">
            {CATEGORIES.map((cat, i) => (
              <Link
                key={cat.name}
                href="/jobs"
                className={`group bg-card hover:border-primary/20 hover:shadow-primary/5 flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${categories.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
                style={{
                  transitionDelay: categories.inView ? `${String(200 + i * 75)}ms` : '0ms',
                }}
              >
                <div className="bg-primary/5 group-hover:bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl transition-colors">
                  <cat.icon className="text-primary h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold">{cat.name}</p>
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
      <section className="py-24 sm:py-32" aria-labelledby="cta-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="cta-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to save?
            </h2>
            <p className="text-muted-foreground mt-4 text-lg">
              Join thousands of homeowners who stopped overpaying for quality service.
            </p>
            <div className="mt-10">
              <Button size="lg" className="min-h-[48px] px-10 text-base" asChild>
                <Link href="/register">
                  Post your first job &mdash; it&apos;s free
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
