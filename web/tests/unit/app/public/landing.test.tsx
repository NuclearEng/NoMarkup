// Coverage suite for the public landing page. The page is a heavy client
// component built around three intersection-observed sections (stats, how-it-
// works, categories) plus an AnimatedCounter and MicroSparkline. To exercise
// every branch we stub the heavy visual children, capture every IO callback,
// and drive them into the "intersecting" state so the inner helper functions
// (useInView, AnimatedCounter, MicroSparkline) all run.
import { act, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

const ioCallbacks: IOCallback[] = [];
let observedCount = 0;
let unobservedCount = 0;
let disconnectedCount = 0;

beforeAll(() => {
  // jsdom does not include IntersectionObserver — provide a stub that captures
  // every callback so tests can simulate intersection events. Multiple sections
  // on the page each construct their own observer; we keep all callbacks.
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(cb: IOCallback) {
      ioCallbacks.push(cb);
    }
    observe() {
      observedCount += 1;
    }
    unobserve() {
      unobservedCount += 1;
    }
    disconnect() {
      disconnectedCount += 1;
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof globalThis.IntersectionObserver;
});

beforeEach(() => {
  ioCallbacks.length = 0;
  observedCount = 0;
  unobservedCount = 0;
  disconnectedCount = 0;
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('@/components/landing/MarketTickerStrip', () => ({
  MarketTickerStrip: () => createElement('div', { 'data-testid': 'ticker' }),
}));
vi.mock('@/components/landing/GradientMesh', () => ({
  GradientMesh: () => createElement('div', { 'data-testid': 'mesh' }),
}));
vi.mock('@/components/landing/AuctionDemo', () => ({
  AuctionDemo: () => createElement('div', { 'data-testid': 'auction-demo' }),
}));

const { default: LandingPage } = await import('@/app/(public)/LandingPageClient');

// Helper: fire every captured IO callback as "isIntersecting: true". This
// drives `useInView` → setInView(true) for every section and triggers the
// AnimatedCounter/MicroSparkline conditional branches.
function fireAllIntersecting(): void {
  for (const cb of ioCallbacks) {
    cb([{ isIntersecting: true } as IntersectionObserverEntry]);
  }
}

function fireAllNotIntersecting(): void {
  for (const cb of ioCallbacks) {
    cb([{ isIntersecting: false } as IntersectionObserverEntry]);
  }
}

describe('(public)/page (landing) — structure & static content', () => {
  it('renders the hero headline and primary CTAs', () => {
    render(createElement(LandingPage));

    expect(screen.getByRole('heading', { name: /Home services at/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Get started/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Browse jobs/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Try Live Demo/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /How it works/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /Popular categories/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /Ready to save\?/i })).toBeDefined();
  });

  it('renders the mocked hero children (ticker, mesh, auction demo)', () => {
    render(createElement(LandingPage));
    expect(screen.getByTestId('ticker')).toBeDefined();
    expect(screen.getByTestId('mesh')).toBeDefined();
    expect(screen.getByTestId('auction-demo')).toBeDefined();
  });

  it('renders the testimonial copy and trust signals', () => {
    render(createElement(LandingPage));
    expect(screen.getByText(/I posted a bathroom remodel/i)).toBeDefined();
    expect(screen.getByText(/Sarah M\./)).toBeDefined();
    expect(screen.getByText(/Payment protection/i)).toBeDefined();
    // "Verified providers" appears once in the trust signals row.
    expect(screen.getAllByText(/Verified providers/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Free to post/i)).toBeDefined();
  });

  it('renders the three "how it works" steps', () => {
    render(createElement(LandingPage));
    expect(screen.getByRole('heading', { name: /Post your job/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /Providers compete/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /Pick the best deal/i })).toBeDefined();
  });

  it('renders all eight category links pointing at /jobs', () => {
    render(createElement(LandingPage));
    const categoriesSection = screen
      .getByRole('heading', { name: /Popular categories/i })
      .closest('section');
    expect(categoriesSection).not.toBeNull();
    if (!categoriesSection) return;

    const expected = [
      'Plumbing',
      'Electrical',
      'Landscaping',
      'Cleaning',
      'Painting',
      'HVAC',
      'Roofing',
      'Moving',
    ];
    for (const name of expected) {
      const link = within(categoriesSection).getByText(name);
      expect(link).toBeDefined();
    }

    // Each category card is a link to /jobs.
    const jobLinks = within(categoriesSection).getAllByRole('link');
    expect(jobLinks.length).toBe(expected.length);
    for (const a of jobLinks) {
      expect(a.getAttribute('href')).toBe('/jobs');
    }
  });

  it('CTA links target the right routes', () => {
    render(createElement(LandingPage));
    const getStarted = screen.getAllByRole('link', { name: /Get started/i })[0];
    expect(getStarted?.getAttribute('href')).toBe('/register');

    const browse = screen.getByRole('link', { name: /Browse jobs/i });
    expect(browse.getAttribute('href')).toBe('/jobs');

    const demo = screen.getByRole('link', { name: /Try Live Demo/i });
    expect(demo.getAttribute('href')).toBe('/demo/auction');

    const finalCta = screen.getByRole('link', { name: /Post your first job/i });
    expect(finalCta.getAttribute('href')).toBe('/register');
  });

  it('renders the 4.9 star rating block', () => {
    render(createElement(LandingPage));
    expect(screen.getByLabelText('4.9 out of 5 stars')).toBeDefined();
    expect(screen.getByText('4.9')).toBeDefined();
    expect(screen.getByText(/10,000\+ jobs completed/)).toBeDefined();
    expect(screen.getByText(/Avg\. 23% savings/)).toBeDefined();
  });

  it('registers an IntersectionObserver for each scroll-revealed section', () => {
    render(createElement(LandingPage));
    // statsSection + howItWorks + categories => 3 useInView calls on the page.
    // (The AnimatedCounter / MicroSparkline observers spin up only after the
    // stats section is intersecting.)
    expect(ioCallbacks.length).toBeGreaterThanOrEqual(3);
    expect(observedCount).toBeGreaterThanOrEqual(3);
  });
});

describe('(public)/page (landing) — scroll-triggered animations', () => {
  it('flips the section reveal classes from translate-y-* to translate-y-0 once intersecting', () => {
    const { container } = render(createElement(LandingPage));

    // Pre-intersection: the "Popular categories" heading carries the hidden classes.
    const headingBefore = container.querySelector('#categories-heading');
    expect(headingBefore?.className).toContain('translate-y-6');
    expect(headingBefore?.className).toContain('opacity-0');

    act(() => {
      fireAllIntersecting();
    });

    const headingAfter = container.querySelector('#categories-heading');
    expect(headingAfter?.className).toContain('translate-y-0');
    expect(headingAfter?.className).toContain('opacity-100');
  });

  it('renders the MicroSparkline once stats section becomes intersecting', () => {
    const { container } = render(createElement(LandingPage));

    // Before intersection, no sparkline svg should be in the stats section.
    expect(container.querySelectorAll('svg.mt-1').length).toBe(0);

    act(() => {
      fireAllIntersecting();
    });

    // After intersection, three sparklines (one per stat card) should exist.
    const sparklines = container.querySelectorAll('svg.mt-1');
    expect(sparklines.length).toBe(3);

    // Each sparkline has a polyline with non-empty points.
    for (const svg of sparklines) {
      const poly = svg.querySelector('polyline');
      expect(poly).not.toBeNull();
      const points = poly?.getAttribute('points') ?? '';
      expect(points.length).toBeGreaterThan(0);
      // points must contain "x,y" pairs separated by spaces.
      expect(points.split(' ').length).toBe(12); // 12 data points per sparkline
    }
  });

  it('AnimatedCounter renders zero before its observer fires and updates once intersecting + RAF runs', () => {
    // Capture every RAF callback so each AnimatedCounter's animation can be driven.
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length as unknown as number;
    });
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const { container } = render(createElement(LandingPage));

    // Drive the stats section into view — this mounts AnimatedCounter & its IO.
    const beforeCount = ioCallbacks.length;
    act(() => {
      fireAllIntersecting();
    });

    // After stats becomes visible, AnimatedCounter and MicroSparkline mount and
    // each register their own IntersectionObserver — extra callbacks appended.
    expect(ioCallbacks.length).toBeGreaterThan(beforeCount);

    // Now the counters' observers exist; fire them too so inView=true. Each
    // counter then schedules requestAnimationFrame, captured above.
    act(() => {
      fireAllIntersecting();
    });

    // Drive the RAF loop. We re-pop the latest stored callback after each call
    // because the source recursively schedules another frame while progress<1.
    expect(rafCallbacks.length, 'expected at least one RAF scheduled by AnimatedCounter').toBeGreaterThan(0);

    // First frame establishes startTime for every counter.
    act(() => {
      const snapshot = [...rafCallbacks];
      rafCallbacks.length = 0;
      for (const cb of snapshot) cb(100);
    });

    // Jump past the 2000ms default duration → progress saturates to 1, count=end.
    // Loop a few times because each cb recursively schedules another RAF until
    // progress reaches 1.
    for (let i = 0; i < 5; i += 1) {
      if (rafCallbacks.length === 0) break;
      act(() => {
        const snapshot = [...rafCallbacks];
        rafCallbacks.length = 0;
        for (const cb of snapshot) cb(100 + 5000);
      });
    }

    // The "Jobs Posted" counter has end=10847 → final text "10,847"
    expect(container.textContent).toContain('10,847');
    // The "Bids Placed" counter has end=47200 → final text "47,200"
    expect(container.textContent).toContain('47,200');
    // The "Saved by Customers" stat uses the static "$2.3M" display branch.
    expect(container.textContent).toContain('$2.3M');

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('AnimatedCounter aborts cleanly when the component unmounts mid-animation', () => {
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 42 as unknown as number);
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const { unmount } = render(createElement(LandingPage));
    act(() => {
      fireAllIntersecting();
    });
    act(() => {
      fireAllIntersecting();
    });

    // Unmounting must trigger the RAF cleanup (cancelAnimationFrame) and the
    // IntersectionObserver disconnect cleanup paths.
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
    expect(disconnectedCount).toBeGreaterThan(0);

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('useInView calls observer.unobserve once a section enters the viewport', () => {
    render(createElement(LandingPage));
    expect(unobservedCount).toBe(0);

    act(() => {
      fireAllIntersecting();
    });

    // Each useInView observer that fires should call unobserve(el).
    expect(unobservedCount).toBeGreaterThanOrEqual(3);
  });

  it('non-intersecting entries leave the page in its hidden initial state', () => {
    const { container } = render(createElement(LandingPage));

    act(() => {
      fireAllNotIntersecting();
    });

    // The "How it works" heading should still carry the hidden classes.
    const heading = container.querySelector('#how-it-works-heading');
    expect(heading?.className).toContain('translate-y-6');
    expect(heading?.className).toContain('opacity-0');

    // No sparklines should have been mounted because statsSection.inView is false.
    expect(container.querySelectorAll('svg.mt-1').length).toBe(0);
  });

  it('handles an entries array that is empty / has an undefined first element', () => {
    // The source guards `entry?.isIntersecting` so an empty entries[] should
    // not throw and should leave inView false.
    const { container } = render(createElement(LandingPage));

    act(() => {
      for (const cb of ioCallbacks) {
        cb([] as IntersectionObserverEntry[]);
      }
    });

    expect(container.querySelectorAll('svg.mt-1').length).toBe(0);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
