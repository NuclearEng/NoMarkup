import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memoryStore = new Map<string, string>();
const memoryStorage: Storage = {
  get length(): number {
    return memoryStore.size;
  },
  clear: () => { memoryStore.clear(); },
  getItem: (key: string) => memoryStore.get(key) ?? null,
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  removeItem: (key: string) => { memoryStore.delete(key); },
  setItem: (key: string, value: string) => { memoryStore.set(key, value); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
});

import { SeasonalDemandBanner } from '@/components/jobs/SeasonalDemandBanner';

describe('SeasonalDemandBanner', () => {
  beforeEach(() => {
    memoryStorage.clear();
    // Force a month inside the HVAC active range (Jun = month 6).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    memoryStorage.clear();
  });

  it('renders nothing for unknown categories', () => {
    const { container } = render(<SeasonalDemandBanner categorySlug="random" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders message when current month is in season for HVAC', () => {
    render(<SeasonalDemandBanner categorySlug="hvac" />);
    expect(screen.getByText(/HVAC demand up 40%/)).toBeDefined();
  });

  it('renders nothing if not in season', () => {
    vi.setSystemTime(new Date('2026-12-15T12:00:00Z'));
    const { container } = render(<SeasonalDemandBanner categorySlug="hvac" />);
    expect(container.firstChild).toBeNull();
  });

  it('hides after user dismisses', () => {
    // Use fireEvent directly so we don't fight fake timers via userEvent.
    render(<SeasonalDemandBanner categorySlug="hvac" />);
    fireEvent.click(screen.getByLabelText('Dismiss seasonal demand notice'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(memoryStorage.getItem('nm_seasonal_dismissed_hvac')).toBe('1');
  });

  it('respects existing dismissal in localStorage', () => {
    memoryStorage.setItem('nm_seasonal_dismissed_hvac', '1');
    const { container } = render(<SeasonalDemandBanner categorySlug="hvac" />);
    expect(container.firstChild).toBeNull();
  });
});
