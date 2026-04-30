import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstallPrompt } from '@/components/pwa/InstallPrompt';

// InstallPrompt has narrow eligibility rules: stays hidden in jsdom (no
// beforeinstallprompt event fires, default visibility is false). The
// test covers the most important property — the component never throws
// or renders during SSR-shaped runs and stays out of the way until
// the browser actually fires beforeinstallprompt.

interface MutableStorage extends Storage {
  clear: () => void;
}

function installStorage(): MutableStorage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => { map.clear(); },
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  } as MutableStorage;
}

describe('InstallPrompt', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(window, 'localStorage', {
      writable: true,
      configurable: true,
      value: installStorage(),
    });
    Object.defineProperty(window, 'sessionStorage', {
      writable: true,
      configurable: true,
      value: installStorage(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when no beforeinstallprompt event has fired', () => {
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/install nomarkup as an app/i)).not.toBeInTheDocument();
  });

  it('does not throw on mount even without browser support', () => {
    expect(() => render(<InstallPrompt />)).not.toThrow();
  });
});
