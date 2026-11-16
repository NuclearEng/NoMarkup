// Pins two things the July token migration lost and 92e36fb0 only partly
// repaired:
//
// 1. Within one status map, two statuses paint the same colour only when they
//    are listed below as meaning the same thing to the reader. "Same colour"
//    is judged on the RESOLVED dark-theme value, not the token name, because
//    several tokens share one value (status-open, trust-elite and bid-active
//    are the same blue; trust-high, status-completed and bid-winning the same
//    green). A new collision fails here until it is a deliberate decision.
// 2. The status / category tokens added for this (status-held, status-elevated,
//    the re-hued status-disputed, category-1…7) meet WCAG AA: 4.5:1 as badge
//    text on its own 10% tint, 3:1 as a solid indicator, in both themes.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { badgeVariants } from '@/components/ui/badge';
import * as badgeClasses from '@/lib/status-badge-classes';
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
  LISTING_ORDER_STATUS_VARIANT,
  MILESTONE_STATUS_DOT_CLASSES,
  PAYMENT_STATUS_CLASSES,
  SCHEDULED_INSTALLMENT_STATUS_CLASSES,
  USER_STATUS_CLASSES,
  VERIFICATION_STATUS_CLASSES,
} from '@/lib/status-badge-classes';
import {
  ALERT_STATUS,
  CONTRACT_STATUS,
  JOB_STATUS,
  LISTING_ORDER_STATUS,
  MILESTONE_STATUS,
  PAYMENT_STATUS,
  RISK_LEVEL,
} from '@/types';

type Rgb = [number, number, number];

const css = readFileSync(path.resolve(__dirname, '../../../src/styles/globals.css'), 'utf8');

/** Body of the first `selector { … }` block that defines `marker`. */
function block(selector: string, marker: string): string {
  let from = 0;
  for (;;) {
    const start = css.indexOf(`\n${selector} {`, from);
    if (start === -1) throw new Error(`no ${selector} block defines ${marker}`);
    const end = css.indexOf('\n}', start);
    const body = css.slice(start, end);
    if (body.includes(marker)) return body;
    from = end;
  }
}

const DARK = block('.dark', '--status-open:');
const LIGHT = block(':root', '--status-open:');

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** A token's colour in one theme block: `H S% L%` channels or a 6-digit hex. */
function resolve(theme: string, token: string): Rgb {
  const hsl = new RegExp(`--${token}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%;`).exec(theme);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  const hex = new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6});`).exec(theme);
  if (hex?.[1]) return hexToRgb(hex[1]);
  throw new Error(`token --${token} is not defined as HSL channels or hex`);
}

function hue([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((v, i) => Math.round(v * alpha + (bg[i] ?? 0) * (1 - alpha))) as Rgb;
}

const NEUTRAL = 'neutral';

/** The token a class string paints with: glass triad, solid dot, or neutral. */
function tokenOf(classes: string): string {
  if (classes === DEFAULT_STATUS_CLASS || classes === 'bg-muted-foreground') return NEUTRAL;
  const triad = /^bg-([a-z0-9-]+)\/10 text-\1 border-\1\/30$/.exec(classes);
  if (triad?.[1]) return triad[1];
  const dot = /^bg-([a-z0-9-]+)$/.exec(classes);
  if (dot?.[1]) return dot[1];
  throw new Error(`not a single-token badge class: ${classes}`);
}

/** Hues closer than this read as one colour on a small badge. */
const MIN_HUE_GAP = 15;

function sameColour(a: string, b: string): boolean {
  if (a === NEUTRAL || b === NEUTRAL) return a === b;
  const gap = Math.abs(hue(resolve(DARK, a)) - hue(resolve(DARK, b)));
  return Math.min(gap, 360 - gap) < MIN_HUE_GAP;
}

interface MapSpec {
  map: Record<string, string>;
  /** Statuses allowed to share a colour because they mean the same thing. */
  sameMeaning: string[][];
}

const MAPS: Record<string, MapSpec> = {
  USER_STATUS_CLASSES: { map: USER_STATUS_CLASSES, sameMeaning: [] },
  DISPUTE_STATUS_CLASSES: { map: DISPUTE_STATUS_CLASSES, sameMeaning: [] },
  GUARANTEE_STATUS_CLASSES: {
    map: GUARANTEE_STATUS_CLASSES,
    sameMeaning: [
      ['under_review', 'investigating'], // someone is looking at it
      ['resolved', 'approved', 'paid'], // ended in the claimant's favour
    ],
  },
  JOB_STATUS_CLASSES: {
    map: JOB_STATUS_CLASSES,
    sameMeaning: [
      ['draft', 'cancelled', 'closed', 'closed_zero_bids', 'expired'], // not live
      ['open', 'reposted'], // taking bids
      ['bidding', 'in_progress'], // in flight
      ['awarded', 'contract_pending'], // winner picked, contract not signed
      ['active', 'completed', 'reviewed'], // healthy / done
    ],
  },
  CONTRACT_STATUS_CLASSES: {
    map: CONTRACT_STATUS_CLASSES,
    sameMeaning: [
      ['cancelled', 'voided', 'abandoned'], // ended without completing
      ['suspended', 'expired'], // not live
      ['active', 'completed'], // healthy / done
    ],
  },
  MILESTONE_STATUS_DOT_CLASSES: { map: MILESTONE_STATUS_DOT_CLASSES, sameMeaning: [] },
  PAYMENT_STATUS_CLASSES: {
    map: PAYMENT_STATUS_CLASSES,
    sameMeaning: [
      ['released', 'completed'], // money arrived
      ['failed', 'chargeback'], // money lost
      ['refunded', 'partially_refunded'], // settled back
    ],
  },
  ADVANCE_STATUS_CLASSES: {
    map: ADVANCE_STATUS_CLASSES,
    sameMeaning: [
      ['approved', 'disbursed'], // granted
      ['defaulted', 'rejected'], // ended badly
    ],
  },
  FLAG_STATUS_CLASSES: { map: FLAG_STATUS_CLASSES, sameMeaning: [] },
  VERIFICATION_STATUS_CLASSES: { map: VERIFICATION_STATUS_CLASSES, sameMeaning: [] },
  FRAUD_RISK_CLASSES: { map: FRAUD_RISK_CLASSES, sameMeaning: [] },
  FRAUD_ALERT_STATUS_CLASSES: {
    map: FRAUD_ALERT_STATUS_CLASSES,
    sameMeaning: [['resolved_fraud', 'resolved_legitimate']], // closed with a finding
  },
  INSURANCE_POLICY_STATUS_CLASSES: { map: INSURANCE_POLICY_STATUS_CLASSES, sameMeaning: [] },
  INSURANCE_CLAIM_STATUS_CLASSES: {
    map: INSURANCE_CLAIM_STATUS_CLASSES,
    sameMeaning: [['approved', 'paid']], // ended in the claimant's favour
  },
  INSTALLMENT_PLAN_STATUS_CLASSES: { map: INSTALLMENT_PLAN_STATUS_CLASSES, sameMeaning: [] },
  SCHEDULED_INSTALLMENT_STATUS_CLASSES: {
    map: SCHEDULED_INSTALLMENT_STATUS_CLASSES,
    sameMeaning: [],
  },
  EXPENSE_CATEGORY_CLASSES: {
    map: EXPENSE_CATEGORY_CLASSES,
    sameMeaning: [['office', 'other']], // uncategorised overhead
  },
};

describe('every status map is covered by this file', () => {
  it('lists each exported *_CLASSES map', () => {
    const exported = Object.keys(badgeClasses).filter((name) => name.endsWith('_CLASSES'));
    expect(Object.keys(MAPS).sort()).toEqual(exported.sort());
  });
});

describe('every status has a class', () => {
  const DOMAINS: [string, Record<string, string>, Record<string, string>][] = [
    ['job', JOB_STATUS, JOB_STATUS_CLASSES],
    ['contract', CONTRACT_STATUS, CONTRACT_STATUS_CLASSES],
    ['payment', PAYMENT_STATUS, PAYMENT_STATUS_CLASSES],
    ['milestone', MILESTONE_STATUS, MILESTONE_STATUS_DOT_CLASSES],
    ['fraud risk', RISK_LEVEL, FRAUD_RISK_CLASSES],
    ['fraud alert', ALERT_STATUS, FRAUD_ALERT_STATUS_CLASSES],
  ];

  for (const [name, statuses, map] of DOMAINS) {
    it(`${name}: every domain value maps to a class`, () => {
      for (const status of Object.values(statuses)) {
        expect(map[status], status).toBeTypeOf('string');
      }
    });
  }

  for (const [name, { map }] of Object.entries(MAPS)) {
    it(`${name}: every entry is a single defined token or the neutral badge`, () => {
      for (const [status, classes] of Object.entries(map)) {
        const token = tokenOf(classes);
        if (token === NEUTRAL) continue;
        // Defined in both themes — a class that resolves to nothing paints nothing.
        expect(() => resolve(DARK, token), `${status} (dark)`).not.toThrow();
        if (token !== 'destructive') {
          expect(() => resolve(LIGHT, token), `${status} (light)`).not.toThrow();
        }
      }
    });
  }
});

describe('statuses that mean different things never share a colour', () => {
  for (const [name, { map, sameMeaning }] of Object.entries(MAPS)) {
    it(name, () => {
      const groupOf = (status: string): number =>
        sameMeaning.findIndex((group) => group.includes(status));
      const statuses = Object.keys(map);
      const collisions: string[] = [];
      for (const [i, a] of statuses.entries()) {
        for (const b of statuses.slice(i + 1)) {
          const shareMeaning = groupOf(a) !== -1 && groupOf(a) === groupOf(b);
          if (shareMeaning) continue;
          if (sameColour(tokenOf(map[a] ?? ''), tokenOf(map[b] ?? ''))) {
            collisions.push(`${a} / ${b}`);
          }
        }
      }
      expect(collisions).toEqual([]);
    });

    it(`${name}: same-meaning groups only name real statuses`, () => {
      for (const status of sameMeaning.flat()) {
        expect(map[status], status).toBeDefined();
      }
    });
  }

  it('the pairs that collided before each have their own colour', () => {
    const differ = (map: Record<string, string>, a: string, b: string): boolean =>
      !sameColour(tokenOf(map[a] ?? ''), tokenOf(map[b] ?? ''));
    expect(differ(FRAUD_RISK_CLASSES, 'high', 'critical')).toBe(true);
    expect(differ(FRAUD_RISK_CLASSES, 'medium', 'high')).toBe(true);
    expect(differ(CONTRACT_STATUS_CLASSES, 'disputed', 'cancelled')).toBe(true);
    expect(differ(PAYMENT_STATUS_CLASSES, 'processing', 'escrow')).toBe(true);
    expect(differ(PAYMENT_STATUS_CLASSES, 'disputed', 'failed')).toBe(true);
    expect(differ(JOB_STATUS_CLASSES, 'disputed', 'suspended')).toBe(true);
    expect(differ(JOB_STATUS_CLASSES, 'open', 'awarded')).toBe(true);
    expect(differ(DISPUTE_STATUS_CLASSES, 'open', 'investigating')).toBe(true);
    expect(differ(MILESTONE_STATUS_DOT_CLASSES, 'revision_requested', 'disputed')).toBe(true);
  });
});

describe('goods order Badge variants', () => {
  it('disputed and cancelled orders do not share a badge', () => {
    const disputed = badgeVariants({ variant: LISTING_ORDER_STATUS_VARIANT[LISTING_ORDER_STATUS.DISPUTED] });
    const cancelled = badgeVariants({ variant: LISTING_ORDER_STATUS_VARIANT[LISTING_ORDER_STATUS.CANCELLED] });
    expect(disputed).toContain('text-status-disputed');
    expect(cancelled).not.toContain('status-disputed');
    expect(disputed).not.toBe(cancelled);
  });
});

describe('new tokens meet WCAG AA', () => {
  const NEW_TOKENS = [
    'status-disputed',
    'status-elevated',
    'status-held',
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => `category-${String(n)}`),
  ];
  // Surfaces a badge sits on. Dark: page, card, raised panel (showcase SSOT).
  const SURFACES: [string, string, Rgb[]][] = [
    ['dark', DARK, [hexToRgb('#07080b'), hexToRgb('#14161e'), hexToRgb('#1e2130')]],
    ['light', LIGHT, [[255, 255, 255], [247, 247, 247]]],
  ];

  for (const [themeName, theme, surfaces] of SURFACES) {
    for (const token of NEW_TOKENS) {
      it(`${token} (${themeName}): text on its 10% tint ≥ 4.5:1, solid indicator ≥ 3:1`, () => {
        const colour = resolve(theme, token);
        for (const surface of surfaces) {
          expect(contrast(colour, mix(colour, surface, 0.1))).toBeGreaterThanOrEqual(4.5);
          // The Badge `disputed` variant uses a 15% tint.
          expect(contrast(colour, mix(colour, surface, 0.15))).toBeGreaterThanOrEqual(4.5);
          expect(contrast(colour, surface)).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  it('the status hues sit apart from each other and from red, amber and blue', () => {
    const hues = ['destructive', 'status-elevated', 'trust-medium', 'status-open', 'status-held', 'status-disputed'].map(
      (token) => hue(resolve(DARK, token)),
    );
    for (const [i, a] of hues.entries()) {
      for (const b of hues.slice(i + 1)) {
        const gap = Math.abs(a - b);
        expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(MIN_HUE_GAP);
      }
    }
  });
});
