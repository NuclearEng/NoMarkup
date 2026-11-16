/**
 * Single-field text rules that do not need a schema library.
 *
 * Several client components validate exactly one string (a chat message, a
 * phone number, revision notes, a review reply) and only ever read the first
 * error message. Importing a Zod schema for that pulls the Zod runtime and the
 * whole `validations` module into the route (~13 kB gzip on /messages, for a
 * length check). These rules are plain data plus a ten-line checker.
 *
 * `src/lib/validations.ts` builds the matching Zod schemas FROM these rules,
 * so the limits and messages have one source; `tests/unit/lib/text-rules.test.ts`
 * asserts `textRuleError` and the schema agree on every input.
 *
 * This module must stay free of imports — that is the point of it.
 */

export interface TextRule {
  readonly min?: number;
  readonly minMessage?: string;
  readonly max?: number;
  /**
   * Shown when the value is longer than `max`. Rules whose schema has no
   * custom message spell out Zod's English default here.
   */
  readonly maxMessage?: string;
  readonly pattern?: RegExp;
  readonly patternMessage?: string;
}

export const CHAT_MESSAGE_RULE = {
  min: 1,
  minMessage: 'Message cannot be empty',
  max: 2000,
  maxMessage: 'Message too long',
} as const satisfies TextRule;

export const PHONE_RULE = {
  pattern: /^\+?[1-9]\d{1,14}$/,
  patternMessage: 'Invalid phone number',
} as const satisfies TextRule;

export const REVISION_NOTES_RULE = {
  min: 10,
  minMessage: 'Revision notes must be at least 10 characters',
  max: 2000,
  // The schema sets no message for the upper bound; this is Zod's default.
  maxMessage: 'Too big: expected string to have <=2000 characters',
} as const satisfies TextRule;

export const REVIEW_RESPONSE_RULE = {
  min: 10,
  minMessage: 'Response must be at least 10 characters',
  max: 2000,
  maxMessage: 'Response must be at most 2000 characters',
} as const satisfies TextRule;

/**
 * First violated rule's message, or `null` when the value passes.
 * Order matches the schema's check order: min length, max length, pattern.
 */
export function textRuleError(rule: TextRule, value: string): string | null {
  if (rule.min !== undefined && value.length < rule.min) {
    return rule.minMessage ?? 'Too short';
  }
  if (rule.max !== undefined && value.length > rule.max) {
    return rule.maxMessage ?? 'Too long';
  }
  if (rule.pattern !== undefined && !rule.pattern.test(value)) {
    return rule.patternMessage ?? 'Invalid format';
  }
  return null;
}
