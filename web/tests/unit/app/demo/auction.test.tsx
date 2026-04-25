// Demo auction page — runs a fake reverse-auction simulation. The page kicks
// off setTimeout-driven bid scripts; we use fake timers so React Testing
// Library renders without scheduling background work.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/demo/auction',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const stub = (testid: string) => () => createElement('div', { 'data-testid': testid });

vi.mock('@/components/landing/GradientMesh', () => ({ GradientMesh: stub('mesh') }));
vi.mock('@/components/terminal/terminal-toolbar', () => ({
  TerminalToolbar: stub('terminal-toolbar'),
}));
vi.mock('@/components/terminal/terminal-grid', () => ({
  TerminalGrid: stub('terminal-grid'),
}));
vi.mock('@/components/bids/SavingsCelebration', () => ({
  SavingsCelebration: () => createElement('div', { 'data-testid': 'savings-celebration' }),
}));

const { default: AuctionDemoPage } = await import('@/app/demo/auction/page');

describe('demo/auction/page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the demo shell with terminal and demo-specific copy', () => {
    render(createElement(AuctionDemoPage));

    expect(screen.getByRole('heading', { name: /Kitchen Renovation/ })).toBeDefined();
    expect(screen.getByText('Live Demo')).toBeDefined();
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
    expect(screen.getByTestId('terminal-toolbar')).toBeDefined();
    // Pause button is rendered initially because the simulation auto-starts
    expect(screen.getByRole('button', { name: /Pause/ })).toBeDefined();
  });
});
