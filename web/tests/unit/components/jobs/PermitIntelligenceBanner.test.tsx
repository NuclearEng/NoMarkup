import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Install an in-memory localStorage shim — jsdom's default does not have a
// stable bound `clear()` once destructured.
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

import { PermitIntelligenceBanner } from '@/components/jobs/PermitIntelligenceBanner';

describe('PermitIntelligenceBanner', () => {
  beforeEach(() => {
    memoryStorage.clear();
  });

  afterEach(() => {
    memoryStorage.clear();
  });

  it('renders nothing for non-permit categories', () => {
    const { container } = render(<PermitIntelligenceBanner categorySlug="cleaning" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders permit notice for permit-bearing categories', () => {
    render(<PermitIntelligenceBanner categorySlug="electrical" />);
    expect(screen.getByText(/permit/i)).toBeDefined();
  });

  it('hides itself after dismiss', async () => {
    const user = userEvent.setup();
    render(<PermitIntelligenceBanner categorySlug="plumbing" />);
    const dismiss = screen.getByLabelText('Dismiss permit information notice');
    await user.click(dismiss);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('persists dismissal in localStorage', async () => {
    const user = userEvent.setup();
    render(<PermitIntelligenceBanner categorySlug="hvac" />);
    await user.click(screen.getByLabelText('Dismiss permit information notice'));
    expect(memoryStorage.getItem('nm_permit_dismissed_hvac')).toBe('1');
  });

  it('respects pre-existing localStorage dismissal', () => {
    memoryStorage.setItem('nm_permit_dismissed_roofing', '1');
    const { container } = render(<PermitIntelligenceBanner categorySlug="roofing" />);
    expect(container.firstChild).toBeNull();
  });
});
