import { describe, expect, it } from 'vitest';

import {
  formatRecurringFrequency,
  formatRecurringStatus,
  hasPaymentRetryInfo,
  isRecurringInstanceApprovable,
  isRecurringInstanceCompletable,
  isRecurringInstancePayable,
  recurringResultHasPayCTA,
} from '@/hooks/useRecurring';
import type { ContractRecurringConfig, RecurringInstanceActionResult } from '@/types';

const REAL_PI = ['pi', '3Test', 'secret', 'abc'].join('_');

describe('useRecurring helpers', () => {
  it('isRecurringInstanceCompletable for scheduled and in_progress only', () => {
    expect(isRecurringInstanceCompletable({ id: '1', status: 'scheduled' })).toBe(true);
    expect(isRecurringInstanceCompletable({ id: '1', status: 'in_progress' })).toBe(true);
    expect(isRecurringInstanceCompletable({ id: '1', status: 'completed' })).toBe(false);
    expect(isRecurringInstanceCompletable({ id: '1', status: 'cancelled' })).toBe(false);
  });

  it('isRecurringInstanceApprovable for completed not yet approved', () => {
    expect(isRecurringInstanceApprovable({ id: '1', status: 'completed' })).toBe(true);
    expect(isRecurringInstanceApprovable({ id: '1', status: 'scheduled' })).toBe(false);
    expect(
      isRecurringInstanceApprovable({ id: '1', status: 'completed', auto_approved: true }),
    ).toBe(false);
    expect(
      isRecurringInstanceApprovable({
        id: '1',
        status: 'completed',
        approved_at: '2026-07-27T12:00:00Z',
      }),
    ).toBe(false);
  });

  it('isRecurringInstancePayable when approved/auto and not funded', () => {
    expect(
      isRecurringInstancePayable({
        id: '1',
        status: 'completed',
        auto_approved: true,
        amount_cents: 5000,
      }),
    ).toBe(true);
    expect(
      isRecurringInstancePayable({
        id: '1',
        status: 'completed',
        approved_at: '2026-07-27T12:00:00Z',
        amount_cents: 5000,
      }),
    ).toBe(true);
    expect(
      isRecurringInstancePayable({
        id: '1',
        status: 'completed',
        auto_approved: true,
        amount_cents: 5000,
        payment_funded: true,
      }),
    ).toBe(false);
    expect(
      isRecurringInstancePayable({
        id: '1',
        status: 'completed',
        amount_cents: 5000,
      }),
    ).toBe(false);
  });

  it('hasPaymentRetryInfo when count > 0 or next_retry_at set', () => {
    expect(hasPaymentRetryInfo({ id: 'r1', payment_retry_count: 2 })).toBe(true);
    expect(
      hasPaymentRetryInfo({ id: 'r1', next_retry_at: '2026-07-30T00:00:00Z' }),
    ).toBe(true);
    expect(hasPaymentRetryInfo({ id: 'r1', payment_retry_count: 0 })).toBe(false);
    expect(hasPaymentRetryInfo({ id: 'r1' })).toBe(false);
  });

  it('recurringResultHasPayCTA requires confirmable secret and not off-session', () => {
    const base: RecurringInstanceActionResult = {
      instance: { id: 'i1', amount_cents: 5000 },
      client_secret: REAL_PI,
      payment_id: 'pay-1',
    };
    expect(recurringResultHasPayCTA(base)).toBe(true);
    expect(recurringResultHasPayCTA({ ...base, off_session_charged: true })).toBe(false);
    expect(recurringResultHasPayCTA({ ...base, client_secret: '' })).toBe(false);
    expect(recurringResultHasPayCTA({ ...base, client_secret: 'dev_seti_x' })).toBe(true);
  });

  it('formats frequency and status labels', () => {
    expect(formatRecurringFrequency('biweekly')).toBe('Biweekly');
    expect(formatRecurringFrequency(undefined)).toBe('Recurring');
    expect(formatRecurringStatus('paused')).toBe('Paused');
  });

  it('config type accepts FR-16.7 fields', () => {
    const cfg: ContractRecurringConfig = {
      id: 'r1',
      payment_retry_count: 1,
      payment_retry_threshold: 3,
      next_retry_at: '2026-08-01T12:00:00Z',
    };
    expect(hasPaymentRetryInfo(cfg)).toBe(true);
  });
});
