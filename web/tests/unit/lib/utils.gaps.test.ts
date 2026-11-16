// utils — money formatting of non-finite input, the paid-vs-owed progress
// rule (never 100% while cents remain), status humanizing, and plan labels.
import { describe, expect, it } from 'vitest';

import {
  formatCents,
  humanizeStatus,
  isAcceptanceExpired,
  repaymentProgress,
  subscriptionTierLabel,
} from '@/lib/utils';

describe('formatCents — non-finite input', () => {
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])('%s renders as $0.00', (value) => {
    expect(formatCents(value)).toBe('$0.00');
  });

  it('formats negative cents', () => {
    expect(formatCents(-1250)).toBe('-$12.50');
  });
});

describe('repaymentProgress', () => {
  it.each([
    ['nothing owed', 0, 0],
    ['a negative total', 500, -100],
    ['a NaN total', 500, Number.NaN],
    ['an infinite total', 500, Number.POSITIVE_INFINITY],
  ])('%s → complete with no balance', (_name, repaid, total) => {
    expect(repaymentProgress(repaid, total)).toEqual({
      percent: 100,
      outstandingCents: 0,
      complete: true,
    });
  });

  it('is complete when repaid equals or exceeds the total (overpayment is not negative balance)', () => {
    expect(repaymentProgress(10_000, 10_000)).toEqual({ percent: 100, outstandingCents: 0, complete: true });
    expect(repaymentProgress(12_000, 10_000)).toEqual({ percent: 100, outstandingCents: 0, complete: true });
  });

  it('caps at 99% while a single cent is outstanding', () => {
    expect(repaymentProgress(99_999, 100_000)).toEqual({
      percent: 99,
      outstandingCents: 1,
      complete: false,
    });
  });

  it('rounds progress down, never up', () => {
    expect(repaymentProgress(1_999, 10_000)).toEqual({
      percent: 19,
      outstandingCents: 8_001,
      complete: false,
    });
  });

  it.each([
    ['negative repaid', -500],
    ['NaN repaid', Number.NaN],
  ])('treats %s as nothing repaid', (_name, repaid) => {
    expect(repaymentProgress(repaid, 10_000)).toEqual({
      percent: 0,
      outstandingCents: 10_000,
      complete: false,
    });
  });
});

describe('humanizeStatus', () => {
  it.each([null, undefined, ''])('%j → empty string', (value) => {
    expect(humanizeStatus(value)).toBe('');
  });

  it.each([
    ['pending_acceptance', 'Pending Acceptance'],
    ['IN-PROGRESS', 'In Progress'],
    ['__awaiting__pickup--', 'Awaiting Pickup'],
    ['paid', 'Paid'],
  ])('%s → %s', (value, label) => {
    expect(humanizeStatus(value)).toBe(label);
  });
});

describe('subscriptionTierLabel', () => {
  it('uses the curated label for a known slug, ignoring the name', () => {
    expect(subscriptionTierLabel({ slug: 'pro_provider', name: 'whatever' })).toBe('Pro (Provider)');
    expect(subscriptionTierLabel({ slug: ' free ' })).toBe('Free');
  });

  it('falls back to the name when there is no slug', () => {
    expect(subscriptionTierLabel({ slug: null, name: 'pro_customer' })).toBe('Pro (Customer)');
  });

  it('humanizes an unknown tier key', () => {
    expect(subscriptionTierLabel({ slug: 'enterprise_plus' })).toBe('Enterprise Plus');
  });

  it('returns an empty label when neither slug nor name is present', () => {
    expect(subscriptionTierLabel({})).toBe('');
    expect(subscriptionTierLabel({ slug: null, name: null })).toBe('');
  });

  it('does not fall back to the name when the slug is an empty string', () => {
    expect(subscriptionTierLabel({ slug: '', name: 'free' })).toBe('');
  });
});

describe('isAcceptanceExpired', () => {
  const now = Date.parse('2026-03-01T12:00:00Z');

  it('is true only for a pending contract whose deadline is strictly in the past', () => {
    expect(isAcceptanceExpired('pending_acceptance', '2026-03-01T11:59:59Z', now)).toBe(true);
    expect(isAcceptanceExpired('pending_acceptance', '2026-03-01T12:00:00Z', now)).toBe(false);
    expect(isAcceptanceExpired('active', '2026-03-01T11:59:59Z', now)).toBe(false);
  });

  it('fails open for a missing or unparseable deadline', () => {
    expect(isAcceptanceExpired('pending_acceptance', null, now)).toBe(false);
    expect(isAcceptanceExpired('pending_acceptance', undefined, now)).toBe(false);
    expect(isAcceptanceExpired('pending_acceptance', 'soon', now)).toBe(false);
  });
});
