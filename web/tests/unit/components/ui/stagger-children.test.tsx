import { act, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StaggerChildren } from '@/components/ui/stagger-children';

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

let lastIOCallback: IOCallback | null = null;
let matchesReducedMotion = false;

beforeAll(() => {
  // jsdom does not include IntersectionObserver — provide a stub that captures
  // the callback so tests can simulate intersection events.
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(cb: IOCallback) {
      lastIOCallback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof globalThis.IntersectionObserver;

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchesReducedMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => {
  matchesReducedMotion = false;
  lastIOCallback = null;
});

describe('StaggerChildren', () => {
  it('renders all children', () => {
    render(
      <StaggerChildren>
        <span>One</span>
        <span>Two</span>
        <span>Three</span>
      </StaggerChildren>,
    );
    expect(screen.getByText('One')).toBeDefined();
    expect(screen.getByText('Two')).toBeDefined();
    expect(screen.getByText('Three')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(
      <StaggerChildren className="stagger-class">
        <span>x</span>
      </StaggerChildren>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('stagger-class');
  });

  it('makes children visible immediately when prefers-reduced-motion is set', () => {
    matchesReducedMotion = true;
    const { container } = render(
      <StaggerChildren>
        <span>Reduced</span>
      </StaggerChildren>,
    );
    matchesReducedMotion = false;
    const wrapper = container.querySelector('.stagger-animated');
    expect(wrapper?.getAttribute('style') ?? '').toContain('animation');
  });

  it('reveals children after IntersectionObserver fires isIntersecting', () => {
    const { container } = render(
      <StaggerChildren staggerMs={100} initialDelay={50}>
        <span>A</span>
        <span>B</span>
      </StaggerChildren>,
    );

    // Initially hidden — opacity: 0
    const before = container.querySelector('.stagger-animated');
    expect(before?.getAttribute('style') ?? '').toContain('opacity');

    // Simulate scrolling into view.
    expect(lastIOCallback).not.toBeNull();
    act(() => {
      if (lastIOCallback) {
        lastIOCallback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
    });

    const after = container.querySelectorAll('.stagger-animated');
    expect(after.length).toBe(2);
    // First child: delay 50ms
    expect(after[0]?.getAttribute('style') ?? '').toContain('50ms');
    // Second child: 50 + 100 = 150ms
    expect(after[1]?.getAttribute('style') ?? '').toContain('150ms');
  });

  it('uses the fade-in animation class when animation="fade-in"', () => {
    const { container } = render(
      <StaggerChildren animation="fade-in">
        <span>F</span>
      </StaggerChildren>,
    );
    act(() => {
      if (lastIOCallback) {
        lastIOCallback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
    });
    const wrapper = container.querySelector('.stagger-animated');
    expect(wrapper?.getAttribute('style') ?? '').toContain('stagger-fade-in');
  });

  it('uses the scale-in animation class when animation="scale-in"', () => {
    const { container } = render(
      <StaggerChildren animation="scale-in">
        <span>S</span>
      </StaggerChildren>,
    );
    act(() => {
      if (lastIOCallback) {
        lastIOCallback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
    });
    const wrapper = container.querySelector('.stagger-animated');
    expect(wrapper?.getAttribute('style') ?? '').toContain('stagger-scale-in');
  });

  it('ignores intersection observer entries that are not intersecting', () => {
    const { container } = render(
      <StaggerChildren>
        <span>NotYet</span>
      </StaggerChildren>,
    );
    act(() => {
      if (lastIOCallback) {
        lastIOCallback([{ isIntersecting: false } as IntersectionObserverEntry]);
      }
    });
    const wrapper = container.querySelector('.stagger-animated');
    // Still hidden — opacity: 0
    expect(wrapper?.getAttribute('style') ?? '').toContain('opacity');
    expect(wrapper?.getAttribute('style') ?? '').not.toContain('animation');
  });
});
