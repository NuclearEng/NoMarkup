import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  canNextImageLoad,
  cn,
  formatCents,
  formatRelativeTime,
  isAcceptanceExpired,
} from '@/lib/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('handles conditional classes', () => {
    const isHidden = false as boolean;
    const result = cn('base', isHidden && 'hidden', 'extra');
    expect(result).toBe('base extra');
  });

  it('resolves Tailwind conflicts by keeping last value', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles undefined and null inputs', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end');
  });

  it('handles empty arguments', () => {
    expect(cn()).toBe('');
  });

  it('handles arrays of class names', () => {
    expect(cn(['px-2', 'py-1'])).toBe('px-2 py-1');
  });

  it('merges complex Tailwind conflicts', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    expect(cn('bg-white', 'bg-black')).toBe('bg-black');
  });

  it('preserves non-conflicting utilities', () => {
    expect(cn('text-red-500', 'bg-blue-500', 'p-4')).toBe(
      'text-red-500 bg-blue-500 p-4',
    );
  });
});

describe('formatCents', () => {
  it('formats whole dollar amounts', () => {
    expect(formatCents(1000)).toBe('$10.00');
  });

  it('formats amounts with cents', () => {
    expect(formatCents(1050)).toBe('$10.50');
  });

  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00');
  });

  it('formats single cent', () => {
    expect(formatCents(1)).toBe('$0.01');
  });

  it('formats large amounts with commas', () => {
    expect(formatCents(1000000)).toBe('$10,000.00');
  });

  it('formats negative amounts', () => {
    expect(formatCents(-500)).toBe('-$5.00');
  });

  it('formats amounts under a dollar', () => {
    expect(formatCents(99)).toBe('$0.99');
  });
});

describe('isAcceptanceExpired', () => {
  const now = new Date('2026-06-07T12:00:00Z').getTime();

  it('is true when pending_acceptance and the deadline is in the past', () => {
    expect(isAcceptanceExpired('pending_acceptance', '2026-06-01T00:00:00Z', now)).toBe(true);
  });

  it('is false when the deadline is still in the future', () => {
    expect(isAcceptanceExpired('pending_acceptance', '2099-01-01T00:00:00Z', now)).toBe(false);
  });

  it('is false for non-pending statuses even with a past deadline', () => {
    expect(isAcceptanceExpired('active', '2000-01-01T00:00:00Z', now)).toBe(false);
    expect(isAcceptanceExpired('cancelled', '2000-01-01T00:00:00Z', now)).toBe(false);
  });

  it('is false (fails open) for a missing or unparseable deadline', () => {
    expect(isAcceptanceExpired('pending_acceptance', null, now)).toBe(false);
    expect(isAcceptanceExpired('pending_acceptance', undefined, now)).toBe(false);
    expect(isAcceptanceExpired('pending_acceptance', 'not-a-date', now)).toBe(false);
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for times less than 1 minute ago', () => {
    const date = new Date('2026-03-03T11:59:30Z');
    expect(formatRelativeTime(date)).toBe('just now');
  });

  it('returns minutes ago for times less than 1 hour', () => {
    const date = new Date('2026-03-03T11:45:00Z');
    expect(formatRelativeTime(date)).toBe('15m ago');
  });

  it('returns 1m ago for exactly 1 minute', () => {
    const date = new Date('2026-03-03T11:59:00Z');
    expect(formatRelativeTime(date)).toBe('1m ago');
  });

  it('returns 59m ago for 59 minutes', () => {
    const date = new Date('2026-03-03T11:01:00Z');
    expect(formatRelativeTime(date)).toBe('59m ago');
  });

  it('returns hours ago for times less than 24 hours', () => {
    const date = new Date('2026-03-03T06:00:00Z');
    expect(formatRelativeTime(date)).toBe('6h ago');
  });

  it('returns 1h ago for exactly 1 hour', () => {
    const date = new Date('2026-03-03T11:00:00Z');
    expect(formatRelativeTime(date)).toBe('1h ago');
  });

  it('returns days ago for times less than 30 days', () => {
    const date = new Date('2026-03-01T12:00:00Z');
    expect(formatRelativeTime(date)).toBe('2d ago');
  });

  it('returns 1d ago for exactly 1 day', () => {
    const date = new Date('2026-03-02T12:00:00Z');
    expect(formatRelativeTime(date)).toBe('1d ago');
  });

  it('returns formatted date for times 30+ days ago', () => {
    const date = new Date('2026-01-15T12:00:00Z');
    const result = formatRelativeTime(date);
    expect(result).toBe('Jan 15');
  });
});

describe('canNextImageLoad', () => {
  it('returns false for null/undefined/empty', () => {
    expect(canNextImageLoad(null)).toBe(false);
    expect(canNextImageLoad(undefined)).toBe(false);
    expect(canNextImageLoad('')).toBe(false);
  });

  it('allows relative paths and data URIs', () => {
    expect(canNextImageLoad('/static/photo.jpg')).toBe(true);
    expect(canNextImageLoad('data:image/png;base64,abc')).toBe(true);
  });

  it('allows allowlisted remote hosts (next.config remotePatterns)', () => {
    expect(canNextImageLoad('http://localhost:9000/nomarkup-dev/p.jpg')).toBe(true);
  });

  it('rejects un-allowlisted remote hosts so the page degrades instead of crashing', () => {
    // Regression guard: unsplash seed photos must NOT be handed to next/image,
    // which throws "Invalid src prop … hostname not configured" and crashes
    // the whole tree to the root error boundary.
    expect(
      canNextImageLoad('https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=800'),
    ).toBe(false);
    expect(canNextImageLoad('https://example.com/p.jpg')).toBe(false);
  });

  it('rejects unparseable values', () => {
    expect(canNextImageLoad('not a url')).toBe(false);
  });
});
