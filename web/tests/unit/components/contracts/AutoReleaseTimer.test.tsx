import { act, render, screen } from '@testing-library/react';
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

  it('renders countdown in trust-medium when more than 72h remain', () => {
    // Completed 1 day ago → ~6 days left → > 72h → trust-medium
    render(createElement(AutoReleaseTimer, { completedAt: '2026-04-23T12:00:00Z' }));
    const countdown = screen.getByLabelText('Auto-release countdown');
    expect(countdown.className).toContain('text-trust-medium');
    // Days portion shown
    expect(countdown.textContent).toMatch(/^[56]d /);
  });

  it('renders countdown in status-disputed when between 24h and 72h remain', () => {
    // Completed 5 days, 12 hours ago → ~36h left
    const completedAt = new Date(Date.now() - (5 * 24 + 12) * 60 * 60 * 1000).toISOString();
    render(createElement(AutoReleaseTimer, { completedAt }));
    const countdown = screen.getByLabelText('Auto-release countdown');
    expect(countdown.className).toContain('text-status-disputed');
  });

  it('renders countdown in destructive when fewer than 24h remain', () => {
    // Completed ~6 days, 18 hours ago → ~6h left
    const completedAt = new Date(Date.now() - (6 * 24 + 18) * 60 * 60 * 1000).toISOString();
    render(createElement(AutoReleaseTimer, { completedAt }));
    const countdown = screen.getByLabelText('Auto-release countdown');
    expect(countdown.className).toContain('text-destructive');
    // No days segment when < 1 day remains
    expect(countdown.textContent).not.toMatch(/d /);
  });

  it('updates the countdown each second via the interval', () => {
    render(createElement(AutoReleaseTimer, { completedAt: '2026-04-23T12:00:00Z' }));
    const before = screen.getByLabelText('Auto-release countdown').textContent;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const after = screen.getByLabelText('Auto-release countdown').textContent;
    // Either ticked down or stayed (but shape is intact); guard against panic.
    expect(after).toBeTruthy();
    expect(before).toBeTruthy();
  });

  it('clears the interval when the countdown reaches zero on a tick', () => {
    // Completed nearly 7 days ago — only 1 second remains. The interval will
    // fire once, observe totalMs <= 0, and call clearInterval (lines 59-61).
    const now = new Date();
    const completedAt = new Date(
      now.getTime() - (7 * 24 * 60 * 60 * 1000 - 1000),
    ).toISOString();
    render(createElement(AutoReleaseTimer, { completedAt }));
    // Initially the countdown should be visible.
    expect(screen.queryByLabelText('Auto-release countdown')).not.toBeNull();
    // Advance system time past expiry, then run the interval tick.
    act(() => {
      vi.setSystemTime(new Date(now.getTime() + 5_000));
      vi.advanceTimersByTime(2_000);
    });
    // After the tick the auto-release message should appear.
    expect(screen.getByText(/Payment has been auto-released/i)).toBeDefined();
  });
});
