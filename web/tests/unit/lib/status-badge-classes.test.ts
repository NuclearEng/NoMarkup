import { describe, expect, it } from 'vitest';

import {
  ADVANCE_STATUS_CLASSES,
  CONTRACT_STATUS_CLASSES,
  DEFAULT_STATUS_CLASS,
  DISPUTE_STATUS_CLASSES,
  EXPENSE_CATEGORY_CLASSES,
  FLAG_STATUS_CLASSES,
  FRAUD_ALERT_STATUS_CLASSES,
  FRAUD_RISK_CLASSES,
  GUARANTEE_STATUS_CLASSES,
  INSTALLMENT_PLAN_STATUS_CLASSES,
  INSURANCE_CLAIM_STATUS_CLASSES,
  INSURANCE_POLICY_STATUS_CLASSES,
  JOB_STATUS_CLASSES,
  PAYMENT_STATUS_CLASSES,
  SCHEDULED_INSTALLMENT_STATUS_CLASSES,
  USER_STATUS_CLASSES,
  VERIFICATION_STATUS_CLASSES,
} from '@/lib/status-badge-classes';

/**
 * status-badge-classes.ts is a set of pure lookup tables — string status keys
 * to Tailwind class strings. We assert:
 * 1. Each map exposes the expected keys with non-empty string values.
 * 2. Each value is the glass triad for the expected SEMANTIC TOKEN of that
 *    state (trust-high = success, destructive = danger, trust-medium =
 *    warning, status-open = info, status-held = held for a decision,
 *    status-elevated = raised severity, status-disputed = contested; expense
 *    categories use the categorical palette). The tables used raw palette families
 *    (green/red/yellow/blue/zinc) until the design-system token migration
 *    (a6ef4b35 + 44e22917, 2026-07-26; raw palette utilities are now banned
 *    on chrome badges), so these assertions name tokens, not colors.
 * 3. Unknown keys return undefined (no defaulting at this layer — callers
 *    handle fallback themselves).
 * 4. Empty / weird keys return undefined (no panics, no surprise hits).
 */

/** The canonical glass triad for one semantic token. */
function glass(token: string): string {
  return `bg-${token}/10 text-${token} border-${token}/30`;
}

/** Neutral / inactive states share the muted default badge. */
const NEUTRAL = DEFAULT_STATUS_CLASS;

// All maps share the same shape (Record<string, string>).
const ALL_MAPS = {
  USER_STATUS_CLASSES,
  DISPUTE_STATUS_CLASSES,
  GUARANTEE_STATUS_CLASSES,
  JOB_STATUS_CLASSES,
  PAYMENT_STATUS_CLASSES,
  ADVANCE_STATUS_CLASSES,
  CONTRACT_STATUS_CLASSES,
  FLAG_STATUS_CLASSES,
  VERIFICATION_STATUS_CLASSES,
  FRAUD_RISK_CLASSES,
  FRAUD_ALERT_STATUS_CLASSES,
  INSURANCE_POLICY_STATUS_CLASSES,
  INSURANCE_CLAIM_STATUS_CLASSES,
  INSTALLMENT_PLAN_STATUS_CLASSES,
  SCHEDULED_INSTALLMENT_STATUS_CLASSES,
  EXPENSE_CATEGORY_CLASSES,
} as const;

describe('status-badge-classes — shape invariants', () => {
  for (const [name, map] of Object.entries(ALL_MAPS)) {
    describe(name, () => {
      it('exposes only non-empty string values', () => {
        const entries = Object.entries(map);
        expect(entries.length).toBeGreaterThan(0);
        for (const [key, value] of entries) {
          expect(typeof value).toBe('string');
          expect(value.length).toBeGreaterThan(0);
          expect(key.length).toBeGreaterThan(0);
        }
      });

      it('every value is one token\'s glass triad "bg-T/10 text-T border-T/30" or the neutral badge', () => {
        for (const value of Object.values(map)) {
          if (value === NEUTRAL) continue;
          // One semantic token, used consistently for the translucent
          // background, the text, and the translucent border. Raw palette
          // utilities (e.g. green-500) are not allowed here.
          const triad = /^bg-([a-z]+(?:-[a-z0-9]+)*)\/10 text-([a-z]+(?:-[a-z0-9]+)*) border-([a-z]+(?:-[a-z0-9]+)*)\/30$/.exec(
            value,
          );
          expect(triad, value).not.toBeNull();
          expect(triad?.[2]).toBe(triad?.[1]);
          expect(triad?.[3]).toBe(triad?.[1]);
        }
      });

      it('returns undefined for unknown keys', () => {
        expect(map['definitely-not-a-real-status']).toBeUndefined();
      });

      it('returns undefined for empty string', () => {
        expect(map['']).toBeUndefined();
      });
    });
  }
});

describe('USER_STATUS_CLASSES — semantic tokens', () => {
  it('active is trust-high (success)', () => {
    expect(USER_STATUS_CLASSES['active']).toBe(glass('trust-high'));
  });

  it('suspended is trust-medium (warning)', () => {
    expect(USER_STATUS_CLASSES['suspended']).toBe(glass('trust-medium'));
  });

  it('banned is destructive (danger)', () => {
    expect(USER_STATUS_CLASSES['banned']).toBe(glass('destructive'));
  });

  it('deactivated is the neutral badge', () => {
    expect(USER_STATUS_CLASSES['deactivated']).toBe(NEUTRAL);
  });
});

describe('JOB_STATUS_CLASSES — semantic tokens', () => {
  it('open is status-open (info)', () => {
    expect(JOB_STATUS_CLASSES['open']).toBe(glass('status-open'));
  });

  it('bidding is status-in-progress', () => {
    expect(JOB_STATUS_CLASSES['bidding']).toBe(glass('status-in-progress'));
  });

  it('completed is status-completed (success)', () => {
    expect(JOB_STATUS_CLASSES['completed']).toBe(glass('status-completed'));
  });

  it('disputed is status-disputed', () => {
    expect(JOB_STATUS_CLASSES['disputed']).toBe(glass('status-disputed'));
  });

  it('cancelled / closed / expired are neutral', () => {
    expect(JOB_STATUS_CLASSES['cancelled']).toBe(NEUTRAL);
    expect(JOB_STATUS_CLASSES['closed']).toBe(NEUTRAL);
    expect(JOB_STATUS_CLASSES['expired']).toBe(NEUTRAL);
  });

  it('in_progress and bidding share the in-progress treatment', () => {
    expect(JOB_STATUS_CLASSES['in_progress']).toBe(JOB_STATUS_CLASSES['bidding']);
  });

  it('awarded and contract_pending share the status-held treatment, apart from open', () => {
    expect(JOB_STATUS_CLASSES['awarded']).toBe(glass('status-held'));
    expect(JOB_STATUS_CLASSES['awarded']).toBe(JOB_STATUS_CLASSES['contract_pending']);
    expect(JOB_STATUS_CLASSES['awarded']).not.toBe(JOB_STATUS_CLASSES['open']);
  });
});

describe('PAYMENT_STATUS_CLASSES — semantic tokens', () => {
  it('pending is trust-medium (waiting)', () => {
    expect(PAYMENT_STATUS_CLASSES['pending']).toBe(glass('trust-medium'));
  });

  it('escrow is status-held, never the processing badge', () => {
    expect(PAYMENT_STATUS_CLASSES['escrow']).toBe(glass('status-held'));
    expect(PAYMENT_STATUS_CLASSES['processing']).toBe(glass('status-open'));
  });

  it('released is trust-high and completed is status-completed (terminal success)', () => {
    expect(PAYMENT_STATUS_CLASSES['released']).toBe(glass('trust-high'));
    expect(PAYMENT_STATUS_CLASSES['completed']).toBe(glass('status-completed'));
  });

  it('failed / chargeback are destructive; disputed is status-disputed', () => {
    expect(PAYMENT_STATUS_CLASSES['failed']).toBe(glass('destructive'));
    expect(PAYMENT_STATUS_CLASSES['disputed']).toBe(glass('status-disputed'));
    expect(PAYMENT_STATUS_CLASSES['chargeback']).toBe(glass('destructive'));
  });

  it('refunded variants are neutral, never the pending badge', () => {
    expect(PAYMENT_STATUS_CLASSES['refunded']).toBe(NEUTRAL);
    expect(PAYMENT_STATUS_CLASSES['partially_refunded']).toBe(NEUTRAL);
    expect(PAYMENT_STATUS_CLASSES['refunded']).not.toBe(PAYMENT_STATUS_CLASSES['pending']);
  });
});

describe('FRAUD_RISK_CLASSES — risk ladder', () => {
  it('low is trust-high', () => {
    expect(FRAUD_RISK_CLASSES['low']).toBe(glass('trust-high'));
  });

  it('medium is trust-medium', () => {
    expect(FRAUD_RISK_CLASSES['medium']).toBe(glass('trust-medium'));
  });

  it('high is status-elevated, not the disputed or the critical token', () => {
    expect(FRAUD_RISK_CLASSES['high']).toBe(glass('status-elevated'));
  });

  it('critical is destructive', () => {
    expect(FRAUD_RISK_CLASSES['critical']).toBe(glass('destructive'));
  });
});

describe('ADVANCE_STATUS_CLASSES — working capital lifecycle', () => {
  it('requested is status-open (pending decision)', () => {
    expect(ADVANCE_STATUS_CLASSES['requested']).toBe(glass('status-open'));
  });

  it('approved is trust-high', () => {
    expect(ADVANCE_STATUS_CLASSES['approved']).toBe(glass('trust-high'));
  });

  it('disbursed is bid-winning (money out the door)', () => {
    expect(ADVANCE_STATUS_CLASSES['disbursed']).toBe(glass('bid-winning'));
  });

  it('repaying is status-in-progress (in flight)', () => {
    expect(ADVANCE_STATUS_CLASSES['repaying']).toBe(glass('status-in-progress'));
  });

  it('defaulted and rejected are destructive', () => {
    expect(ADVANCE_STATUS_CLASSES['defaulted']).toBe(glass('destructive'));
    expect(ADVANCE_STATUS_CLASSES['rejected']).toBe(glass('destructive'));
  });
});

describe('GUARANTEE_STATUS_CLASSES — claim flow', () => {
  it('open is status-open, paid is bid-winning, denied is destructive', () => {
    expect(GUARANTEE_STATUS_CLASSES['open']).toBe(glass('status-open'));
    expect(GUARANTEE_STATUS_CLASSES['paid']).toBe(glass('bid-winning'));
    expect(GUARANTEE_STATUS_CLASSES['denied']).toBe(glass('destructive'));
  });

  it('investigating and under_review share the status-held treatment; escalated is status-elevated', () => {
    expect(GUARANTEE_STATUS_CLASSES['investigating']).toBe(glass('status-held'));
    expect(GUARANTEE_STATUS_CLASSES['investigating']).toBe(
      GUARANTEE_STATUS_CLASSES['under_review'],
    );
    expect(GUARANTEE_STATUS_CLASSES['escalated']).toBe(glass('status-elevated'));
  });
});

describe('DISPUTE_STATUS_CLASSES', () => {
  it('open is status-open, investigating is status-held, resolved is status-completed, escalated is status-elevated', () => {
    expect(DISPUTE_STATUS_CLASSES['open']).toBe(glass('status-open'));
    expect(DISPUTE_STATUS_CLASSES['investigating']).toBe(glass('status-held'));
    expect(DISPUTE_STATUS_CLASSES['resolved']).toBe(glass('status-completed'));
    expect(DISPUTE_STATUS_CLASSES['escalated']).toBe(glass('status-elevated'));
  });
});

describe('FLAG_STATUS_CLASSES — moderation', () => {
  it('pending is trust-medium, upheld is destructive, dismissed is status-completed', () => {
    expect(FLAG_STATUS_CLASSES['pending']).toBe(glass('trust-medium'));
    expect(FLAG_STATUS_CLASSES['upheld']).toBe(glass('destructive'));
    expect(FLAG_STATUS_CLASSES['dismissed']).toBe(glass('status-completed'));
  });
});

describe('VERIFICATION_STATUS_CLASSES', () => {
  it('approved is trust-high, rejected is destructive, pending is trust-medium, expired is neutral', () => {
    expect(VERIFICATION_STATUS_CLASSES['approved']).toBe(glass('trust-high'));
    expect(VERIFICATION_STATUS_CLASSES['rejected']).toBe(glass('destructive'));
    expect(VERIFICATION_STATUS_CLASSES['pending']).toBe(glass('trust-medium'));
    expect(VERIFICATION_STATUS_CLASSES['expired']).toBe(NEUTRAL);
  });
});

describe('FRAUD_ALERT_STATUS_CLASSES', () => {
  it('both resolved variants are status-completed (clean closure)', () => {
    expect(FRAUD_ALERT_STATUS_CLASSES['resolved_fraud']).toBe(glass('status-completed'));
    expect(FRAUD_ALERT_STATUS_CLASSES['resolved_legitimate']).toBe(glass('status-completed'));
  });

  it('investigating is status-held, apart from open', () => {
    expect(FRAUD_ALERT_STATUS_CLASSES['open']).toBe(glass('status-open'));
    expect(FRAUD_ALERT_STATUS_CLASSES['investigating']).toBe(glass('status-held'));
  });

  it('dismissed is the neutral badge', () => {
    expect(FRAUD_ALERT_STATUS_CLASSES['dismissed']).toBe(NEUTRAL);
  });
});

describe('INSURANCE_POLICY_STATUS_CLASSES', () => {
  it('active is trust-high, expired is neutral, cancelled is destructive, claimed is status-in-progress', () => {
    expect(INSURANCE_POLICY_STATUS_CLASSES['active']).toBe(glass('trust-high'));
    expect(INSURANCE_POLICY_STATUS_CLASSES['expired']).toBe(NEUTRAL);
    expect(INSURANCE_POLICY_STATUS_CLASSES['cancelled']).toBe(glass('destructive'));
    expect(INSURANCE_POLICY_STATUS_CLASSES['claimed']).toBe(glass('status-in-progress'));
  });
});

describe('INSURANCE_CLAIM_STATUS_CLASSES', () => {
  it('filed is status-open, under_review is status-held, paid is bid-winning, denied is destructive', () => {
    expect(INSURANCE_CLAIM_STATUS_CLASSES['filed']).toBe(glass('status-open'));
    expect(INSURANCE_CLAIM_STATUS_CLASSES['under_review']).toBe(glass('status-held'));
    expect(INSURANCE_CLAIM_STATUS_CLASSES['paid']).toBe(glass('bid-winning'));
    expect(INSURANCE_CLAIM_STATUS_CLASSES['denied']).toBe(glass('destructive'));
  });
});

describe('INSTALLMENT_PLAN_STATUS_CLASSES', () => {
  it('active is status-open, completed is status-completed, defaulted is destructive, cancelled is neutral', () => {
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['active']).toBe(glass('status-open'));
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['completed']).toBe(glass('status-completed'));
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['defaulted']).toBe(glass('destructive'));
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['cancelled']).toBe(NEUTRAL);
  });
});

describe('SCHEDULED_INSTALLMENT_STATUS_CLASSES', () => {
  it('scheduled is neutral, processing is status-open, paid is status-completed, failed is destructive, retrying is status-in-progress', () => {
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['scheduled']).toBe(NEUTRAL);
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['processing']).toBe(glass('status-open'));
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['paid']).toBe(glass('status-completed'));
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['failed']).toBe(glass('destructive'));
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['retrying']).toBe(glass('status-in-progress'));
  });
});

describe('EXPENSE_CATEGORY_CLASSES', () => {
  it('every category has its own categorical token; office and other share the neutral badge', () => {
    expect(EXPENSE_CATEGORY_CLASSES['materials']).toBe(glass('category-1'));
    expect(EXPENSE_CATEGORY_CLASSES['tools']).toBe(glass('category-2'));
    expect(EXPENSE_CATEGORY_CLASSES['transportation']).toBe(glass('category-3'));
    expect(EXPENSE_CATEGORY_CLASSES['insurance']).toBe(glass('category-4'));
    expect(EXPENSE_CATEGORY_CLASSES['licensing']).toBe(glass('category-5'));
    expect(EXPENSE_CATEGORY_CLASSES['marketing']).toBe(glass('category-6'));
    expect(EXPENSE_CATEGORY_CLASSES['subcontractor']).toBe(glass('category-7'));
    expect(EXPENSE_CATEGORY_CLASSES['office']).toBe(NEUTRAL);
    expect(EXPENSE_CATEGORY_CLASSES['other']).toBe(NEUTRAL);
  });

  it('never borrows a status or trust token (a category is not a state)', () => {
    for (const value of Object.values(EXPENSE_CATEGORY_CLASSES)) {
      expect(value).not.toMatch(/status-|trust-|bid-|destructive/);
    }
  });

  it('returns undefined for an unknown category (caller handles fallback)', () => {
    expect(EXPENSE_CATEGORY_CLASSES['not-a-category']).toBeUndefined();
  });
});
