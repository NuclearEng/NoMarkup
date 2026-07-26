'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
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

// AuctionDemo is a heavy client-only widget. `ssr: false` avoids hydration
// mismatches from Date.now() / rAF; aspect-ratio placeholder keeps CLS at 0.
const AuctionDemo = dynamic(
  () => import('@/components/landing/AuctionDemo').then((m) => ({ default: m.AuctionDemo })),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="w-full rounded-2xl bg-white/[0.02]"
        style={{ aspectRatio: '1 / 1.05', minHeight: 320 }}
      />
    ),
  },
);

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

/** Interactive landing island (animations, demo, IO). Seeded from the RSC page. */
export function LandingPageClient() {
  const howItWorks = useInView<HTMLElement>();
  const statsSection = useInView<HTMLElement>();
  const categories = useInView<HTMLElement>();

  return (
    <>
      <section className="relative isolate overflow-hidden bg-background">
        <GradientMesh />

        <div
          className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
          aria-hidden="true"
        />

        <div className="relative z-[2]">
          <MarketTickerStrip speed="normal" />
        </div>

        <div className="relative z-[2] mx-auto max-w-7xl px-4 pt-12 pb-16 sm:px-6 sm:pt-24 sm:pb-32 lg:px-8 lg:pt-28 lg:pb-36">
          <div className="grid items-center gap-8 sm:gap-14 lg:grid-cols-2 lg:gap-20">
            <div className="mx-auto max-w-xl text-center lg:mx-0 lg:text-left">
              <div className="animate-fade-in mb-4 inline-flex items-center gap-2 sm:mb-8">
                <span className="font-mono text-[0.7rem] font-medium tracking-[0.2em] text-brand-gold uppercase">
                  Reverse-Auction Service Marketplace
                </span>
              </div>

              <h1 className="animate-fade-in-up font-display text-4xl leading-[1.1] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
                The Market Sets
                <br />
                The Price.
                <br />
                <em className="text-brand-gold-bright">Not The Markup.</em>
              </h1>

              <p
                className="animate-fade-in-up mt-4 text-base leading-relaxed text-muted-foreground sm:mt-8 sm:text-xl sm:leading-relaxed"
                style={{ animationDelay: '100ms' }}
              >
                Customers post home-service jobs. Qualified providers compete in real-time reverse
                auctions. Prices drop to fair market rates. Everyone wins except the middleman.
              </p>

              <div
                className="animate-fade-in-up mt-6 flex flex-col items-center gap-3 sm:mt-12 sm:flex-row sm:gap-4 lg:justify-start"
                style={{ animationDelay: '200ms' }}
              >
                <Button
                  size="lg"
                  className="glass-cta-gold min-h-[52px] w-full rounded-xl px-9 text-base font-semibold sm:w-auto"
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
                  className="glass-cta-secondary min-h-[52px] w-full rounded-xl px-9 text-base sm:w-auto"
                  asChild
                >
                  <Link href="/jobs">Browse jobs</Link>
                </Button>
                <Link
                  href="/demo/auction"
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-amber-400 transition-colors hover:text-amber-300"
                >
                  <Zap className="h-4 w-4" />
                  Try Live Demo
                </Link>
              </div>

              <div
                className="animate-fade-in-up mt-6 flex flex-wrap items-center justify-center gap-4 sm:mt-12 sm:gap-6 lg:justify-start"
                style={{ animationDelay: '350ms' }}
              >
                <div className="flex items-center gap-3">
                  <div className="avatar-stack flex">
                    {['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'].map((color, i) => (
                      <div
                        key={color}
                        className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[10px] font-bold text-white"
                        style={{ background: color, zIndex: 5 - i }}
                        aria-hidden="true"
                      >
                        {['S', 'M', 'J', 'A', 'R'][i]}
                      </div>
                    ))}
                  </div>
                  <span className="text-sm text-white/60">10,000+ jobs completed</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="flex gap-0.5" role="img" aria-label="4.9 out of 5 stars">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg
                        key={star}
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="#eab308"
                        opacity={star === 5 ? 0.7 : 1}
                        aria-hidden="true"
                      >
                        <path d="M8 0l2.2 5.5L16 6.3l-4 3.7 1 5.5L8 12.8 2.9 15.5l1-5.5-4-3.7 5.9-.8z" />
                      </svg>
                    ))}
                  </div>
                  <span className="text-sm font-medium text-white/70">4.9</span>
                </div>

                <div className="flex items-center gap-1.5 text-sm text-white/60">
                  <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Avg. 23% savings</span>
                </div>
              </div>
            </div>

            <div
              className="animate-fade-in-up mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none"
              style={{ animationDelay: '300ms' }}
            >
              <AuctionDemo />
            </div>
          </div>
        </div>

        <div className="hero-stats-bridge relative z-[2] h-10 sm:h-24" aria-hidden="true" />
      </section>

      <section
        ref={statsSection.ref}
        className="border-b border-white/[0.06] bg-[#0c0f18] py-10 sm:py-16"
        aria-label="Platform statistics"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-3 gap-3 sm:gap-8">
            {STATS.map((stat, i) => (
              <div
                key={stat.label}
                className={`glass-stat-card glass-highlight glass-specular-anim flex flex-col items-center px-3 py-5 text-center transition-all duration-700 sm:px-6 sm:py-8 ${statsSection.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                style={{ transitionDelay: `${String(i * 120)}ms` }}
              >
                <p
                  className="relative z-[3] text-2xl font-black tracking-tight sm:text-5xl"
                  style={{ color: stat.color }}
                >
                  {'display' in stat ? (
                    stat.display
                  ) : (
                    <AnimatedCounter end={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
                  )}
                </p>
                <p className="text-muted-foreground relative z-[3] mt-1 text-[10px] font-medium tracking-wide uppercase sm:mt-2 sm:text-sm">
                  {stat.label}
                </p>
                {statsSection.inView ? (
                  <div className="relative z-[3]">
                    <MicroSparkline data={stat.sparkline} color={stat.color} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        ref={howItWorks.ref}
        className="border-t border-white/[0.06] bg-background py-16 sm:py-36"
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

          <div className="mx-auto mt-10 grid max-w-5xl gap-6 sm:mt-20 sm:grid-cols-3 sm:gap-14">
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
                className={`glass glass-interactive glass-highlight glass-specular-anim step-card-glow relative rounded-2xl p-6 text-center transition-all duration-700 sm:p-8 ${howItWorks.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                style={{ transitionDelay: `${String(200 + i * 150)}ms` }}
              >
                <div
                  className="gold-text relative z-[3] mx-auto text-5xl font-black"
                  aria-hidden="true"
                >
                  {String(item.step)}
                </div>

                <div className="relative z-[3] mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-gold)]/10 ring-1 ring-[var(--brand-gold)]/15">
                  <item.icon className="h-7 w-7" style={{ color: 'var(--brand-gold)' }} />
                </div>

                <h3 className="relative z-[3] mt-5 text-lg font-bold">{item.title}</h3>
                <p className="text-muted-foreground relative z-[3] mt-3 text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="bg-[#0c0f18] py-16 sm:py-36"
        aria-label="Customer testimonial and trust signals"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="glass glass-elevated glass-highlight glass-specular-anim mx-auto max-w-2xl rounded-2xl p-6 text-center sm:p-12">
            <div
              className="gold-text relative z-[3] mx-auto mb-6 text-6xl leading-none font-black"
              aria-hidden="true"
            >
              &ldquo;
            </div>
            <blockquote className="relative z-[3]">
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

      <section
        ref={categories.ref}
        className="border-t border-white/[0.06] bg-background py-16 sm:py-36"
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

          <div className="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-3 sm:mt-16 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:gap-6">
            {CATEGORIES.map((cat, i) => (
              <Link
                key={cat.name}
                href="/jobs"
                className={`glass glass-interactive glass-highlight group flex flex-col items-center gap-2 rounded-2xl p-4 text-center transition-all duration-300 hover:border-[var(--brand-gold)]/20 sm:gap-3 sm:p-7 ${categories.inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
                style={{
                  transitionDelay: categories.inView ? `${String(200 + i * 75)}ms` : '0ms',
                }}
              >
                <div className="relative z-[3] flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-gold)]/[0.08] ring-1 ring-[var(--brand-gold)]/10 transition-colors group-hover:bg-[var(--brand-gold)]/[0.14] sm:h-14 sm:w-14 sm:rounded-2xl">
                  <cat.icon
                    className="animate-icon-hover h-5 w-5 transition-transform sm:h-6 sm:w-6"
                    style={{ color: 'var(--brand-gold)' }}
                  />
                </div>
                <div className="relative z-[3]">
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

      <section className="bg-[#0c0f18] py-16 sm:py-36" aria-labelledby="cta-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="glass glass-elevated glass-highlight glass-tinted-gold glass-specular-anim mx-auto max-w-2xl rounded-2xl p-6 text-center sm:p-14">
            <h2
              id="cta-heading"
              className="relative z-[3] text-3xl font-black tracking-tight sm:text-4xl"
            >
              Ready to save?
            </h2>
            <p className="text-muted-foreground relative z-[3] mt-5 text-lg">
              Join thousands of homeowners who stopped overpaying for quality service.
            </p>
            <div className="relative z-[3] mt-8 sm:mt-12">
              <Button
                size="lg"
                className="glass-cta-gold min-h-[52px] w-full rounded-xl px-10 text-base font-semibold sm:w-auto"
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

export default LandingPageClient;
