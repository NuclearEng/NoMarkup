import { describe, expect, it } from 'vitest';

import {
  ADVANCE_STATUS_CLASSES,
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
 * 2. Each value contains the expected color family for that semantic state
 *    (green = success, red = danger, yellow/amber = warning, blue = info, etc.).
 * 3. Unknown keys return undefined (no defaulting at this layer — callers
 *    handle fallback themselves).
 * 4. Empty / weird keys return undefined (no panics, no surprise hits).
 */

// All maps share the same shape (Record<string, string>).
const ALL_MAPS = {
  USER_STATUS_CLASSES,
  DISPUTE_STATUS_CLASSES,
  GUARANTEE_STATUS_CLASSES,
  JOB_STATUS_CLASSES,
  PAYMENT_STATUS_CLASSES,
  ADVANCE_STATUS_CLASSES,
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

      it('every value follows the glass-tinted "bg-X/10 text-X border-X/30" pattern', () => {
        for (const value of Object.values(map)) {
          // Must contain a translucent background, a 300/400-weight text,
          // and a translucent border — the canonical glass triad.
          expect(value).toMatch(/bg-[a-z]+-\d+\/10/);
          expect(value).toMatch(/text-[a-z]+-\d+/);
          expect(value).toMatch(/border-[a-z]+-\d+\/30/);
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

describe('USER_STATUS_CLASSES — semantic colors', () => {
  it('active is green (success)', () => {
    expect(USER_STATUS_CLASSES['active']).toContain('green');
  });

  it('suspended is yellow (warning)', () => {
    expect(USER_STATUS_CLASSES['suspended']).toContain('yellow');
  });

  it('banned is red (danger)', () => {
    expect(USER_STATUS_CLASSES['banned']).toContain('red');
  });

  it('deactivated is zinc (neutral)', () => {
    expect(USER_STATUS_CLASSES['deactivated']).toContain('zinc');
  });
});

describe('JOB_STATUS_CLASSES — semantic colors', () => {
  it('open is blue (info)', () => {
    expect(JOB_STATUS_CLASSES['open']).toContain('blue');
  });

  it('bidding is amber (in-progress)', () => {
    expect(JOB_STATUS_CLASSES['bidding']).toContain('amber');
  });

  it('completed is green (success)', () => {
    expect(JOB_STATUS_CLASSES['completed']).toContain('green');
  });

  it('disputed is red (danger)', () => {
    expect(JOB_STATUS_CLASSES['disputed']).toContain('red');
  });

  it('cancelled / closed / expired are zinc (neutral)', () => {
    expect(JOB_STATUS_CLASSES['cancelled']).toContain('zinc');
    expect(JOB_STATUS_CLASSES['closed']).toContain('zinc');
    expect(JOB_STATUS_CLASSES['expired']).toContain('zinc');
  });

  it('in_progress and bidding share the amber treatment', () => {
    expect(JOB_STATUS_CLASSES['in_progress']).toBe(JOB_STATUS_CLASSES['bidding']);
  });

  it('awarded and contract_pending share the purple treatment', () => {
    expect(JOB_STATUS_CLASSES['awarded']).toBe(JOB_STATUS_CLASSES['contract_pending']);
  });
});

describe('PAYMENT_STATUS_CLASSES — semantic colors', () => {
  it('pending is yellow (waiting)', () => {
    expect(PAYMENT_STATUS_CLASSES['pending']).toContain('yellow');
  });

  it('escrow is purple (held)', () => {
    expect(PAYMENT_STATUS_CLASSES['escrow']).toContain('purple');
  });

  it('released and completed both use green (terminal success)', () => {
    expect(PAYMENT_STATUS_CLASSES['released']).toContain('green');
    expect(PAYMENT_STATUS_CLASSES['completed']).toContain('green');
  });

  it('failed / disputed / chargeback are red (danger)', () => {
    expect(PAYMENT_STATUS_CLASSES['failed']).toContain('red');
    expect(PAYMENT_STATUS_CLASSES['disputed']).toContain('red');
    expect(PAYMENT_STATUS_CLASSES['chargeback']).toContain('red');
  });

  it('refunded variants are orange', () => {
    expect(PAYMENT_STATUS_CLASSES['refunded']).toContain('orange');
    expect(PAYMENT_STATUS_CLASSES['partially_refunded']).toContain('orange');
  });
});

describe('FRAUD_RISK_CLASSES — risk ladder', () => {
  it('low is green', () => {
    expect(FRAUD_RISK_CLASSES['low']).toContain('green');
  });

  it('medium is yellow', () => {
    expect(FRAUD_RISK_CLASSES['medium']).toContain('yellow');
  });

  it('high is orange', () => {
    expect(FRAUD_RISK_CLASSES['high']).toContain('orange');
  });

  it('critical is red', () => {
    expect(FRAUD_RISK_CLASSES['critical']).toContain('red');
  });
});

describe('ADVANCE_STATUS_CLASSES — working capital lifecycle', () => {
  it('requested is blue (pending decision)', () => {
    expect(ADVANCE_STATUS_CLASSES['requested']).toContain('blue');
  });

  it('approved is green', () => {
    expect(ADVANCE_STATUS_CLASSES['approved']).toContain('green');
  });

  it('disbursed is emerald (money out the door)', () => {
    expect(ADVANCE_STATUS_CLASSES['disbursed']).toContain('emerald');
  });

  it('repaying is amber (in flight)', () => {
    expect(ADVANCE_STATUS_CLASSES['repaying']).toContain('amber');
  });

  it('defaulted and rejected are red', () => {
    expect(ADVANCE_STATUS_CLASSES['defaulted']).toContain('red');
    expect(ADVANCE_STATUS_CLASSES['rejected']).toContain('red');
  });
});

describe('GUARANTEE_STATUS_CLASSES — claim flow', () => {
  it('open is blue, paid is emerald, denied is red', () => {
    expect(GUARANTEE_STATUS_CLASSES['open']).toContain('blue');
    expect(GUARANTEE_STATUS_CLASSES['paid']).toContain('emerald');
    expect(GUARANTEE_STATUS_CLASSES['denied']).toContain('red');
  });

  it('investigating and under_review share the purple treatment', () => {
    expect(GUARANTEE_STATUS_CLASSES['investigating']).toBe(
      GUARANTEE_STATUS_CLASSES['under_review'],
    );
  });
});

describe('DISPUTE_STATUS_CLASSES', () => {
  it('open is blue, investigating is purple, resolved is green, escalated is red', () => {
    expect(DISPUTE_STATUS_CLASSES['open']).toContain('blue');
    expect(DISPUTE_STATUS_CLASSES['investigating']).toContain('purple');
    expect(DISPUTE_STATUS_CLASSES['resolved']).toContain('green');
    expect(DISPUTE_STATUS_CLASSES['escalated']).toContain('red');
  });
});

describe('FLAG_STATUS_CLASSES — moderation', () => {
  it('pending is yellow, upheld is red, dismissed is green', () => {
    expect(FLAG_STATUS_CLASSES['pending']).toContain('yellow');
    expect(FLAG_STATUS_CLASSES['upheld']).toContain('red');
    expect(FLAG_STATUS_CLASSES['dismissed']).toContain('green');
  });
});

describe('VERIFICATION_STATUS_CLASSES', () => {
  it('approved is green, rejected is red, pending is yellow, expired is zinc', () => {
    expect(VERIFICATION_STATUS_CLASSES['approved']).toContain('green');
    expect(VERIFICATION_STATUS_CLASSES['rejected']).toContain('red');
    expect(VERIFICATION_STATUS_CLASSES['pending']).toContain('yellow');
    expect(VERIFICATION_STATUS_CLASSES['expired']).toContain('zinc');
  });
});

describe('FRAUD_ALERT_STATUS_CLASSES', () => {
  it('both resolved variants are green (clean closure)', () => {
    expect(FRAUD_ALERT_STATUS_CLASSES['resolved_fraud']).toContain('green');
    expect(FRAUD_ALERT_STATUS_CLASSES['resolved_legitimate']).toContain('green');
  });

  it('dismissed is zinc (neutral)', () => {
    expect(FRAUD_ALERT_STATUS_CLASSES['dismissed']).toContain('zinc');
  });
});

describe('INSURANCE_POLICY_STATUS_CLASSES', () => {
  it('active is green, expired is zinc, cancelled is red, claimed is amber', () => {
    expect(INSURANCE_POLICY_STATUS_CLASSES['active']).toContain('green');
    expect(INSURANCE_POLICY_STATUS_CLASSES['expired']).toContain('zinc');
    expect(INSURANCE_POLICY_STATUS_CLASSES['cancelled']).toContain('red');
    expect(INSURANCE_POLICY_STATUS_CLASSES['claimed']).toContain('amber');
  });
});

describe('INSURANCE_CLAIM_STATUS_CLASSES', () => {
  it('filed is blue, paid is emerald, denied is red', () => {
    expect(INSURANCE_CLAIM_STATUS_CLASSES['filed']).toContain('blue');
    expect(INSURANCE_CLAIM_STATUS_CLASSES['paid']).toContain('emerald');
    expect(INSURANCE_CLAIM_STATUS_CLASSES['denied']).toContain('red');
  });
});

describe('INSTALLMENT_PLAN_STATUS_CLASSES', () => {
  it('active is blue, completed is green, defaulted is red, cancelled is zinc', () => {
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['active']).toContain('blue');
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['completed']).toContain('green');
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['defaulted']).toContain('red');
    expect(INSTALLMENT_PLAN_STATUS_CLASSES['cancelled']).toContain('zinc');
  });
});

describe('SCHEDULED_INSTALLMENT_STATUS_CLASSES', () => {
  it('scheduled is zinc, processing is blue, paid is green, failed is red, retrying is amber', () => {
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['scheduled']).toContain('zinc');
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['processing']).toContain('blue');
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['paid']).toContain('green');
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['failed']).toContain('red');
    expect(SCHEDULED_INSTALLMENT_STATUS_CLASSES['retrying']).toContain('amber');
  });
});

describe('EXPENSE_CATEGORY_CLASSES', () => {
  it('every documented category has a unique-ish color', () => {
    expect(EXPENSE_CATEGORY_CLASSES['materials']).toContain('blue');
    expect(EXPENSE_CATEGORY_CLASSES['tools']).toContain('purple');
    expect(EXPENSE_CATEGORY_CLASSES['transportation']).toContain('amber');
    expect(EXPENSE_CATEGORY_CLASSES['insurance']).toContain('green');
    expect(EXPENSE_CATEGORY_CLASSES['licensing']).toContain('cyan');
    expect(EXPENSE_CATEGORY_CLASSES['marketing']).toContain('pink');
    expect(EXPENSE_CATEGORY_CLASSES['subcontractor']).toContain('orange');
    expect(EXPENSE_CATEGORY_CLASSES['office']).toContain('zinc');
    expect(EXPENSE_CATEGORY_CLASSES['other']).toContain('slate');
  });

  it('returns undefined for an unknown category (caller handles fallback)', () => {
    expect(EXPENSE_CATEGORY_CLASSES['not-a-category']).toBeUndefined();
  });
});
