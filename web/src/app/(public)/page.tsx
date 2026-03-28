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
  Star,
  TrendingDown,
  Shield,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Intersection Observer hook for scroll-triggered animations
// ---------------------------------------------------------------------------
function useInView<T extends HTMLElement>(options?: IntersectionObserverInit) {
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
// Page
// ---------------------------------------------------------------------------
export default function LandingPage() {
  const howItWorks = useInView<HTMLElement>();
  const stats = useInView<HTMLElement>();
  const categories = useInView<HTMLElement>();

  return (
    <>
      {/* ================================================================= */}
      {/* HERO                                                              */}
      {/* ================================================================= */}
      <section className="relative isolate overflow-hidden">
        {/* Background: subtle radial gradient */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(120,119,198,0.08),transparent)]" />
          <div className="absolute top-0 right-0 h-[600px] w-[600px] translate-x-1/3 -translate-y-1/4 rounded-full bg-[radial-gradient(circle,rgba(120,119,198,0.05),transparent_70%)]" />
          <div className="absolute bottom-0 left-0 h-[400px] w-[400px] -translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.04),transparent_70%)]" />
        </div>

        <div className="mx-auto max-w-7xl px-4 pt-20 pb-24 sm:px-6 sm:pt-28 sm:pb-32 lg:px-8 lg:pt-36 lg:pb-40">
          <div className="mx-auto max-w-3xl text-center">
            {/* Eyebrow badge */}
            <div className="animate-fade-in border-border/60 bg-muted/50 text-muted-foreground mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm backdrop-blur-sm">
              <TrendingDown className="h-3.5 w-3.5" />
              <span>Providers compete. You save.</span>
            </div>

            {/* Main headline */}
            <h1 className="animate-fade-in-up text-foreground text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Home services at{' '}
              <span className="animate-gradient bg-gradient-to-r from-blue-600 via-violet-600 to-blue-600 bg-clip-text text-transparent">
                fair prices
              </span>
            </h1>

            {/* Sub-headline */}
            <p
              className="animate-fade-in-up text-muted-foreground mx-auto mt-6 max-w-2xl text-lg leading-relaxed sm:text-xl"
              style={{ animationDelay: '100ms' }}
            >
              Post what you need, then watch qualified providers compete for your business. A
              reverse auction means the price goes{' '}
              <span className="text-foreground font-semibold">down</span>, not up.
            </p>

            {/* CTAs */}
            <div
              className="animate-fade-in-up mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
              style={{ animationDelay: '200ms' }}
            >
              <Button size="lg" className="min-h-[48px] px-8 text-base" asChild>
                <Link href="/register">
                  Get started
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="min-h-[48px] px-8 text-base" asChild>
                <Link href="/jobs">Browse jobs</Link>
              </Button>
            </div>

            {/* Floating social proof badges */}
            <div
              className="animate-fade-in-up mt-16 flex flex-wrap items-center justify-center gap-3 sm:gap-4"
              style={{ animationDelay: '350ms' }}
            >
              <SocialProofBadge
                icon={<TrendingDown className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                label="Avg. 23% savings"
                delay={0}
              />
              <SocialProofBadge
                icon={<BadgeCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                label="10,000+ jobs completed"
                delay={1}
              />
              <SocialProofBadge
                icon={<Star className="h-4 w-4 text-amber-500" />}
                label="4.9★ average rating"
                delay={2}
              />
            </div>
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
      {/* TRUST & STATS                                                     */}
      {/* ================================================================= */}
      <section ref={stats.ref} className="py-24 sm:py-32" aria-labelledby="trust-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Stat counters */}
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 sm:gap-12 lg:grid-cols-4">
            {[
              { value: 2300000, prefix: '$', suffix: '+', label: 'Saved by customers' },
              { value: 15000, suffix: '+', label: 'Jobs completed' },
              { value: 4800, suffix: '+', label: 'Verified providers' },
              { value: 49, prefix: '', suffix: '', label: 'Average rating', display: '4.9★' },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`text-center transition-all duration-700 ${stats.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                style={{ transitionDelay: `${String(i * 100)}ms` }}
              >
                <p className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {stat.display ? (
                    stat.display
                  ) : (
                    <AnimatedCounter end={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
                  )}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div
            className={`mx-auto mt-20 max-w-2xl text-center transition-all delay-500 duration-700 ${stats.inView ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
          >
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
          <div
            className={`text-muted-foreground mx-auto mt-12 flex max-w-lg flex-wrap items-center justify-center gap-6 text-sm transition-all delay-700 duration-700 ${stats.inView ? 'opacity-100' : 'opacity-0'}`}
          >
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

// ---------------------------------------------------------------------------
// Social proof badge (floating pill in hero)
// ---------------------------------------------------------------------------
function SocialProofBadge({
  icon,
  label,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  delay: number;
}) {
  return (
    <div
      className="animate-float border-border/60 bg-card/80 flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-sm backdrop-blur-sm"
      style={{ animationDelay: `${String(delay * 600)}ms` }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}
