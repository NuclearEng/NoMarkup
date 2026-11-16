// Pins what each status badge MEANS, map by map. The July design-token
// migration (a6ef4b35 + 44e22917) folded several palette colours into one
// token, which made refunded payments read as pending, expired jobs read as
// non-neutral, and high fraud risk borrow the "disputed" token. These tables
// are the contract: change one only with a deliberate design decision.
import { describe, expect, it } from 'vitest';

import {
  CONTRACT_STATUS_CLASSES,
  DEFAULT_STATUS_CLASS,
  FRAUD_RISK_CLASSES,
  JOB_STATUS_CLASSES,
  LISTING_ORDER_STATUS_VARIANT,
  PAYMENT_STATUS_CLASSES,
  listingOrderStatusVariant,
} from '@/lib/status-badge-classes';
import { CONTRACT_STATUS, JOB_STATUS, LISTING_ORDER_STATUS, PAYMENT_STATUS } from '@/types';

const NEUTRAL = 'neutral';

/** The semantic token a class string paints with, or 'neutral'. */
function tokenOf(classes: string | undefined): string | undefined {
  if (classes === undefined) return undefined;
  if (classes === DEFAULT_STATUS_CLASS) return NEUTRAL;
  const match = /^bg-([a-z-]+)\/10 text-\1 border-\1\/30$/.exec(classes);
  return match?.[1];
}

function tokens(map: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, tokenOf(v)]));
}

describe('payment status → token', () => {
  it('pins every payment status', () => {
    expect(tokens(PAYMENT_STATUS_CLASSES)).toEqual({
      pending: 'trust-medium',
      processing: 'status-open',
      escrow: 'trust-elite',
      released: 'trust-high',
      completed: 'status-completed',
      failed: 'destructive',
      refunded: NEUTRAL,
      partially_refunded: NEUTRAL,
      disputed: 'status-disputed',
      chargeback: 'destructive',
    });
  });

  it('covers every PAYMENT_STATUS value', () => {
    for (const status of Object.values(PAYMENT_STATUS)) {
      expect(PAYMENT_STATUS_CLASSES[status], status).toBeDefined();
    }
  });

  it('a refund never looks like a pending, failed or completed payment', () => {
    for (const refund of ['refunded', 'partially_refunded']) {
      for (const other of ['pending', 'failed', 'completed', 'disputed']) {
        expect(PAYMENT_STATUS_CLASSES[refund]).not.toBe(PAYMENT_STATUS_CLASSES[other]);
      }
    }
  });
});

describe('job status → token', () => {
  it('pins every job status', () => {
    expect(tokens(JOB_STATUS_CLASSES)).toEqual({
      draft: NEUTRAL,
      active: 'trust-high',
      open: 'status-open',
      bidding: 'status-in-progress',
      awarded: 'trust-elite',
      contract_pending: 'trust-elite',
      in_progress: 'status-in-progress',
      completed: 'status-completed',
      reviewed: 'status-completed',
      disputed: 'status-disputed',
      cancelled: NEUTRAL,
      reposted: 'bid-active',
      closed: NEUTRAL,
      closed_zero_bids: NEUTRAL,
      expired: NEUTRAL,
      suspended: 'destructive',
    });
  });

  it('covers every JOB_STATUS value', () => {
    for (const status of Object.values(JOB_STATUS)) {
      expect(JOB_STATUS_CLASSES[status], status).toBeDefined();
    }
  });
});

describe('fraud risk → token', () => {
  it('climbs the trust scale and ends on destructive', () => {
    expect(tokens(FRAUD_RISK_CLASSES)).toEqual({
      low: 'trust-high',
      medium: 'trust-medium',
      high: 'trust-low',
      critical: 'destructive',
    });
  });

  it('gives each risk level its own badge', () => {
    expect(new Set(Object.values(FRAUD_RISK_CLASSES)).size).toBe(4);
  });
});

describe('contract status → token', () => {
  it('pins every contract status', () => {
    expect(tokens(CONTRACT_STATUS_CLASSES)).toEqual({
      pending_acceptance: 'trust-medium',
      active: 'trust-high',
      completed: 'status-completed',
      cancelled: 'destructive',
      voided: 'destructive',
      abandoned: 'destructive',
      disputed: 'status-disputed',
      suspended: NEUTRAL,
      expired: NEUTRAL,
    });
  });

  it('covers every CONTRACT_STATUS value', () => {
    for (const status of Object.values(CONTRACT_STATUS)) {
      expect(CONTRACT_STATUS_CLASSES[status], status).toBeDefined();
    }
  });
});

describe('goods order status → Badge variant', () => {
  it('pins every order status', () => {
    expect(LISTING_ORDER_STATUS_VARIANT).toEqual({
      pending: 'pending',
      paid: 'active',
      picked_up: 'active',
      completed: 'completed',
      disputed: 'disputed',
      cancelled: 'cancelled',
    });
  });

  it('covers every LISTING_ORDER_STATUS value', () => {
    for (const status of Object.values(LISTING_ORDER_STATUS)) {
      expect(LISTING_ORDER_STATUS_VARIANT[status], status).toBeDefined();
    }
  });

  it('an unknown status gets the neutral chip', () => {
    expect(listingOrderStatusVariant('refund_pending')).toBe('secondary');
  });
});
