import { describe, expect, it } from 'vitest';

import {
  contractPaymentsFor,
  isOneShotContractPayable,
  oneShotAlreadyPaid,
  oneShotInFlight,
  type OneShotPayGate,
} from '@/lib/contract-one-shot-pay';
import { CONTRACT_STATUS, PAYMENT_STATUS, PAYMENT_TIMING, type Payment } from '@/types';

function gate(overrides: Partial<OneShotPayGate> = {}): OneShotPayGate {
  return {
    isCustomer: true,
    status: CONTRACT_STATUS.ACTIVE,
    amountCents: 15_000,
    paymentTiming: PAYMENT_TIMING.COMPLETION,
    hasRecurringConfig: false,
    hasInstallmentPlan: false,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    contract_id: 'c-1',
    customer_id: 'cust',
    provider_id: 'prov',
    amount_cents: 15_000,
    platform_fee_cents: 0,
    guarantee_fee_cents: 0,
    provider_payout_cents: 15_000,
    status: PAYMENT_STATUS.ESCROW,
    refund_amount_cents: 0,
    created_at: '2026-04-20T00:00:00Z',
    ...overrides,
  };
}

describe('isOneShotContractPayable', () => {
  it('allows a customer one-shot on an active or completed contract', () => {
    expect(isOneShotContractPayable(gate())).toBe(true);
    expect(isOneShotContractPayable(gate({ status: CONTRACT_STATUS.COMPLETED }))).toBe(true);
    expect(isOneShotContractPayable(gate({ paymentTiming: PAYMENT_TIMING.UPFRONT }))).toBe(true);
    expect(isOneShotContractPayable(gate({ paymentTiming: '' }))).toBe(true);
  });

  it('excludes non-customers, zero or fractional cents, and unpaid statuses', () => {
    expect(isOneShotContractPayable(gate({ isCustomer: false }))).toBe(false);
    expect(isOneShotContractPayable(gate({ amountCents: 0 }))).toBe(false);
    expect(isOneShotContractPayable(gate({ amountCents: 10.5 }))).toBe(false);
    expect(isOneShotContractPayable(gate({ status: CONTRACT_STATUS.PENDING_ACCEPTANCE }))).toBe(false);
  });

  it('excludes recurring visits and installment plans', () => {
    expect(isOneShotContractPayable(gate({ paymentTiming: PAYMENT_TIMING.RECURRING }))).toBe(false);
    expect(isOneShotContractPayable(gate({ paymentTiming: PAYMENT_TIMING.PAYMENT_PLAN }))).toBe(false);
    expect(isOneShotContractPayable(gate({ hasRecurringConfig: true }))).toBe(false);
    expect(isOneShotContractPayable(gate({ hasInstallmentPlan: true }))).toBe(false);
  });
});

describe('one-shot payment state', () => {
  it('treats escrow, released, completed, and partial refund as already paid', () => {
    for (const status of [
      PAYMENT_STATUS.ESCROW,
      PAYMENT_STATUS.RELEASED,
      PAYMENT_STATUS.COMPLETED,
      PAYMENT_STATUS.PARTIALLY_REFUNDED,
    ]) {
      expect(oneShotAlreadyPaid([payment({ status })])).toBe(true);
    }
    expect(oneShotAlreadyPaid([payment({ status: PAYMENT_STATUS.FAILED })])).toBe(false);
  });

  it('treats pending and processing as in flight', () => {
    expect(oneShotInFlight([payment({ status: PAYMENT_STATUS.PENDING })])).toBe(true);
    expect(oneShotInFlight([payment({ status: PAYMENT_STATUS.PROCESSING })])).toBe(true);
    expect(oneShotInFlight([payment({ status: PAYMENT_STATUS.ESCROW })])).toBe(false);
  });

  it('keeps payments for the contract only', () => {
    const rows = contractPaymentsFor(
      [payment(), payment({ id: 'other', contract_id: 'c-2' })],
      'c-1',
    );
    expect(rows.map((row) => row.id)).toEqual(['pay-1']);
    expect(contractPaymentsFor(undefined, 'c-1')).toEqual([]);
  });
});
