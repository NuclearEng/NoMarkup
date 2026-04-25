import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoReleaseTimer } from '@/components/contracts/AutoReleaseTimer';

describe('AutoReleaseTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders countdown for an actively-completed contract (within 7 days)', () => {
    // Completed 1 day ago, so 6 days left
    render(createElement(AutoReleaseTimer, { completedAt: '2026-04-23T12:00:00Z' }));
    expect(screen.getByText('Auto-Release Countdown')).toBeDefined();
    expect(screen.getByLabelText('Auto-release countdown')).toBeDefined();
  });

  it('shows the auto-release explanation note', () => {
    render(createElement(AutoReleaseTimer, { completedAt: '2026-04-23T12:00:00Z' }));
    expect(screen.getByText(/Payment will be automatically released/i)).toBeDefined();
  });

  it('shows the released state when countdown is past 7 days', () => {
    render(createElement(AutoReleaseTimer, { completedAt: '2026-04-10T12:00:00Z' }));
    expect(screen.getByText(/Payment has been auto-released/i)).toBeDefined();
  });
});
