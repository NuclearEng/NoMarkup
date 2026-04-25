// Smoke test for the marketing landing page. The page is a heavy client
// component with intersection-observer animations and many lucide icons; we
// stub the heaviest visual children and assert the headline + key CTAs land.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  globalThis.IntersectionObserver = class IntersectionObserver {
    root = null;
    rootMargin = '';
    thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof globalThis.IntersectionObserver;
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

const { default: LandingPage } = await import('@/app/(public)/page');

describe('(public)/page (landing)', () => {
  it('renders the hero headline and primary CTAs', () => {
    render(createElement(LandingPage));

    // Hero headline split across nodes — match the literal start
    expect(screen.getByRole('heading', { name: /Home services at/i })).toBeDefined();
    // Primary CTA + secondary CTA
    expect(screen.getByRole('link', { name: /Get started/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Browse jobs/i })).toBeDefined();
    // How it works section heading
    expect(screen.getByRole('heading', { name: /How it works/i })).toBeDefined();
    // Categories section
    expect(screen.getByRole('heading', { name: /Popular categories/i })).toBeDefined();
  });
});
