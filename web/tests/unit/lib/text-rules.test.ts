// text-rules.ts is the Zod-free path for components that validate one string.
// The schemas in validations.ts are built from the same rules; these tests
// hold the two to the same verdict and the same first error message.
import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_RULE,
  PHONE_RULE,
  REVIEW_RESPONSE_RULE,
  REVISION_NOTES_RULE,
  textRuleError,
  type TextRule,
} from '@/lib/text-rules';
import {
  chatMessageSchema,
  phoneSchema,
  reviewResponseSchema,
  revisionNotesSchema,
} from '@/lib/validations';

const SAMPLES = [
  '',
  ' ',
  'a',
  'x'.repeat(9),
  'x'.repeat(10),
  'x'.repeat(11),
  'x'.repeat(1999),
  'x'.repeat(2000),
  'x'.repeat(2001),
  'x'.repeat(5000),
  '+14155552671',
  '14155552671',
  '4155552671',
  '+0123456789',
  '0123',
  '+1',
  '+12',
  '+1234567890123456',
  '415-555-2671',
  'not a phone',
  'line one\nline two',
  'ünïcödé 🙂 text',
];

const PAIRS: [string, TextRule, typeof chatMessageSchema][] = [
  ['chat message', CHAT_MESSAGE_RULE, chatMessageSchema],
  ['phone', PHONE_RULE, phoneSchema],
  ['revision notes', REVISION_NOTES_RULE, revisionNotesSchema],
  ['review response', REVIEW_RESPONSE_RULE, reviewResponseSchema],
];

describe('textRuleError agrees with the matching schema', () => {
  for (const [name, rule, schema] of PAIRS) {
    it(name, () => {
      let rejected = 0;
      let accepted = 0;
      for (const sample of SAMPLES) {
        const parsed = schema.safeParse(sample);
        const expected = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
        expect(textRuleError(rule, sample), JSON.stringify(sample.slice(0, 24))).toBe(expected);
        if (parsed.success) accepted++;
        else rejected++;
      }
      // Guard against a vacuous pass: every rule must see both outcomes.
      expect(accepted).toBeGreaterThan(0);
      expect(rejected).toBeGreaterThan(0);
    });
  }
});

describe('textRuleError', () => {
  it('reports the lower bound before the upper bound and the pattern', () => {
    const rule: TextRule = {
      min: 3,
      minMessage: 'short',
      max: 5,
      maxMessage: 'long',
      pattern: /^\d+$/,
      patternMessage: 'digits',
    };
    expect(textRuleError(rule, 'ab')).toBe('short');
    expect(textRuleError(rule, 'abcdef')).toBe('long');
    expect(textRuleError(rule, 'abcd')).toBe('digits');
    expect(textRuleError(rule, '1234')).toBeNull();
  });

  it('falls back to a generic message when a rule has none', () => {
    expect(textRuleError({ min: 2 }, 'a')).toBe('Too short');
    expect(textRuleError({ max: 1 }, 'ab')).toBe('Too long');
    expect(textRuleError({ pattern: /^a$/ }, 'b')).toBe('Invalid format');
  });

  it('accepts anything when the rule is empty', () => {
    expect(textRuleError({}, '')).toBeNull();
  });

  it('keeps the revision-notes upper bound message equal to the schema default', () => {
    const tooLong = 'x'.repeat(2001);
    expect(revisionNotesSchema.safeParse(tooLong).error?.issues[0]?.message).toBe(
      REVISION_NOTES_RULE.maxMessage,
    );
  });
});
