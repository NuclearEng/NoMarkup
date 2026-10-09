// Gate for the one-shot service escrow pay CTA.
// Recurring visits and installment plans have their own checkouts — this path
// charges the contract amount once via POST /api/v1/payments.

import { CONTRACT_STATUS, PAYMENT_STATUS, PAYMENT_TIMING, type Payment } from '@/types';

const FUNDED_STATUSES: ReadonlySet<string> = new Set([
  PAYMENT_STATUS.ESCROW,
  PAYMENT_STATUS.RELEASED,
  PAYMENT_STATUS.COMPLETED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
]);

const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set([
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.PROCESSING,
]);

export interface OneShotPayGate {
  isCustomer: boolean;
  status: string;
  /** Server contract total. Non-integers are not payable (no client rounding). */
  amountCents: number;
  paymentTiming: string;
  hasRecurringConfig: boolean;
  hasInstallmentPlan: boolean;
}

/** Upfront, completion, milestone, and unspecified. Not recurring or a plan. */
export function isOneShotServiceTiming(paymentTiming: string): boolean {
  const timing = paymentTiming.trim().toLowerCase();
  if (timing === PAYMENT_TIMING.RECURRING) return false;
  if (timing === PAYMENT_TIMING.PAYMENT_PLAN) return false;
  return true;
}

/**
 * Contract-level payability. Does not look at existing payments — the pay
 * surface hides itself once a charge is in flight or already funded.
 */
export function isOneShotContractPayable(gate: OneShotPayGate): boolean {
  if (!gate.isCustomer) return false;
  if (!Number.isInteger(gate.amountCents) || gate.amountCents <= 0) return false;
  const status = gate.status.trim().toLowerCase();
  if (status !== CONTRACT_STATUS.ACTIVE && status !== CONTRACT_STATUS.COMPLETED) {
    return false;
  }
  if (gate.hasRecurringConfig) return false;
  if (gate.hasInstallmentPlan) return false;
  return isOneShotServiceTiming(gate.paymentTiming);
}

export function contractPaymentsFor(
  payments: readonly Payment[] | undefined,
  contractId: string,
): Payment[] {
  const id = contractId.trim();
  if (!id) return [];
  return (payments ?? []).filter((payment) => payment.contract_id === id);
}

export function oneShotAlreadyPaid(payments: readonly Payment[]): boolean {
  return payments.some((payment) => FUNDED_STATUSES.has(payment.status));
}

export function oneShotInFlight(payments: readonly Payment[]): boolean {
  return payments.some((payment) => IN_FLIGHT_STATUSES.has(payment.status));
}
