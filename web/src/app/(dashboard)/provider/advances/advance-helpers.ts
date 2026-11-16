import type { WorkingCapitalAdvance } from '@/types';

/**
 * Remaining balance on an advance: principal + fee − repaid, floored at 0 so an
 * over-collected advance never reports a negative balance. This is the maximum a
 * manual repayment can be — the gateway 422s anything larger.
 *
 * Lives here (not in page.tsx) because a Next.js `page.tsx` may only export the
 * default component + framework fields; a stray named export fails `next build`.
 */
export function outstandingCents(advance: WorkingCapitalAdvance): number {
  return Math.max(0, advance.advance_amount_cents + advance.fee_cents - advance.repaid_cents);
}
