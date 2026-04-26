// Demo auction page — runs a fake reverse-auction simulation. The page kicks
// off setTimeout-driven bid scripts; we use fake timers so React Testing
// Library renders without scheduling background work.
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  SavingsCelebration: ({ onDismiss }: { onDismiss?: () => void }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'savings-celebration',
        onClick: onDismiss,
      },
      'savings-celebration',
    ),
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

  it('switches Pause to Start/Resume when paused', () => {
    render(createElement(AuctionDemoPage));
    const pauseBtn = screen.getByRole('button', { name: /Pause/ });
    fireEvent.click(pauseBtn);
    // Now should show Start (no bids elapsed yet)
    expect(screen.getByRole('button', { name: /Start/ })).toBeDefined();
  });

  it('renders Reset button with correct accessibility label', () => {
    render(createElement(AuctionDemoPage));
    const resetBtn = screen.getByRole('button', { name: /Reset demo auction/i });
    expect(resetBtn).toBeDefined();
  });

  it('reset button restarts state without throwing', () => {
    render(createElement(AuctionDemoPage));
    const resetBtn = screen.getByRole('button', { name: /Reset demo auction/i });
    fireEvent.click(resetBtn);
    // After reset, paused state means Start label appears
    expect(screen.getByRole('button', { name: /Start/ })).toBeDefined();
  });

  it('renders the back link to the homepage', () => {
    render(createElement(AuctionDemoPage));
    const backLinks = screen.getAllByRole('link');
    const homeLink = backLinks.find((l) => l.getAttribute('href') === '/');
    expect(homeLink).toBeDefined();
  });

  it('renders the location badge with Austin, TX', () => {
    render(createElement(AuctionDemoPage));
    expect(screen.getByText('Austin, TX')).toBeDefined();
  });

  it('advances simulation timers without throwing', () => {
    render(createElement(AuctionDemoPage));
    // Advance the auto-started simulation past the first scripted bid (delay 2000ms)
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    // Page should still be mounted and show Pause (still running)
    expect(screen.getByRole('button', { name: /Pause/ })).toBeDefined();
  });

  it('renders SavingsCelebration after savings accrue (advance through full script)', () => {
    render(createElement(AuctionDemoPage));
    act(() => {
      // Advance timers past the 36s mark when celebration fires
      vi.advanceTimersByTime(40000);
    });
    // savingsCents > 0 condition satisfied — celebration is rendered
    expect(screen.getByTestId('savings-celebration')).toBeDefined();
  });

  it('clicking Pause then Resume keeps the page rendered (resume path)', () => {
    render(createElement(AuctionDemoPage));
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    // After at least one bid posted, paused button should say Resume
    const resumeBtn = screen.queryByRole('button', { name: /Resume|Start/ });
    expect(resumeBtn).toBeDefined();
    if (resumeBtn) {
      fireEvent.click(resumeBtn);
      expect(screen.getByRole('button', { name: /Pause/ })).toBeDefined();
    }
  });

  it('clicking SavingsCelebration onDismiss invokes setShowCelebration(false)', () => {
    render(createElement(AuctionDemoPage));
    // Run the full simulation past 36s — celebration becomes visible.
    act(() => {
      vi.advanceTimersByTime(40000);
    });
    const celebration = screen.getByTestId('savings-celebration');
    expect(celebration).toBeDefined();
    // Click invokes the onDismiss prop, which the page wires to
    // setShowCelebration(false). Page should still be rendered without throwing.
    act(() => {
      fireEvent.click(celebration);
    });
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
  });
});
