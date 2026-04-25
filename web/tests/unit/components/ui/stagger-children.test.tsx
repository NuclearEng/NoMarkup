import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { StaggerChildren } from '@/components/ui/stagger-children';

beforeAll(() => {
  // jsdom does not include IntersectionObserver — provide a minimal stub
  globalThis.IntersectionObserver = class IntersectionObserver {
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

  // matchMedia stub
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
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
});
