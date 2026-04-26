import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceCountdown } from '@/components/contracts/AcceptanceCountdown';

describe('AcceptanceCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows expired state for past deadlines', () => {
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-23T00:00:00Z' }));
    expect(screen.getByText('Deadline Expired')).toBeDefined();
  });

  it('renders countdown for future deadline (full layout)', () => {
    // 2 days, 3 hours later
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-26T15:00:00Z' }));
    expect(screen.getByLabelText('Acceptance deadline countdown')).toBeDefined();
    expect(screen.getByText(/Acceptance Deadline/i)).toBeDefined();
  });

  it('renders compact view with "to accept" text', () => {
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-26T15:00:00Z', compact: true }));
    expect(screen.getByLabelText('Acceptance deadline')).toBeDefined();
    expect(screen.getByText(/to accept/)).toBeDefined();
  });

  it('expired state in compact mode also shows Deadline Expired', () => {
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-23T00:00:00Z', compact: true }));
    expect(screen.getByText('Deadline Expired')).toBeDefined();
  });

  it('uses yellow color when between 1 and 24 hours remain', () => {
    // deadline 5 hours from now
    const { container } = render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-24T17:00:00Z' }),
    );
    // 1 <= totalHours <= 24 → yellow
    expect(container.querySelector('.text-yellow-600')).not.toBeNull();
  });

  it('uses red color when less than 1 hour remains', () => {
    // deadline 30 min from now
    const { container } = render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-24T12:30:00Z' }),
    );
    // < 1 hour → red
    expect(container.querySelector('.text-red-600')).not.toBeNull();
  });

  it('uses green color when more than 24 hours remain', () => {
    const { container } = render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-26T15:00:00Z' }),
    );
    expect(container.querySelector('.text-green-600')).not.toBeNull();
  });

  it('compact mode formats hours when no days remain', () => {
    render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-24T17:00:00Z', compact: true }),
    );
    // 5h 0m
    expect(screen.getByText(/5h\s+0m to accept/)).toBeDefined();
  });

  it('compact mode formats minutes/seconds when no hours remain', () => {
    // 30 min from now (no days, no hours)
    render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-24T12:30:00Z', compact: true }),
    );
    expect(screen.getByText(/30m\s+0s to accept/)).toBeDefined();
  });

  it('compact mode formats days+hours when days remain', () => {
    // 2 days, 3 hours from now
    render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-26T15:00:00Z', compact: true }),
    );
    expect(screen.getByText(/2d\s+3h to accept/)).toBeDefined();
  });

  it('updates the time remaining each second via interval', () => {
    // deadline 2 minutes from now
    render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-24T12:02:00Z', compact: true }),
    );
    expect(screen.getByText(/2m\s+0s to accept/)).toBeDefined();

    // advance 1 second — interval ticks
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/1m\s+59s to accept/)).toBeDefined();
  });

  it('clears the interval and renders Expired once countdown reaches zero', () => {
    // deadline 2 seconds from now
    render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-24T12:00:02Z', compact: true }),
    );
    expect(screen.getByText(/0m\s+2s to accept/)).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByText('Deadline Expired')).toBeDefined();
  });

  it('renders day + HH:MM:SS format when days remain in full layout', () => {
    // 1 day, 2 hours, 3 minutes, 4 seconds away
    render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-25T14:03:04Z' }),
    );
    expect(screen.getByText(/1d 02:03:04/)).toBeDefined();
  });

  it('renders HH:MM:SS only when no days remain in full layout', () => {
    // 5 hours, 0 minutes, 0 seconds away
    render(
      createElement(AcceptanceCountdown, { deadline: '2026-04-24T17:00:00Z' }),
    );
    expect(screen.getByText('05:00:00')).toBeDefined();
  });
});
