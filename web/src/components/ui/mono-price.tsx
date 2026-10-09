import { cn, formatCents } from '@/lib/utils';

interface MonoPriceProps {
  /** Integer cents. Null/undefined/non-finite renders an em dash. */
  cents: number | null | undefined;
  className?: string;
  /**
   * Accessible label override. Default is the formatted currency string
   * (via `aria-label` only when `as="div"` would otherwise lack text — the
   * visible text is the price itself).
   */
  'aria-label'?: string;
}

/**
 * Terminal-grade money display — JetBrains Mono + tabular figures.
 *
 * Bloomberg density without inventing a second currency format. Always use
 * this (or `AnimatedPrice`, which shares the mono stack) for prices that
 * users compare, bid against, or track live. Body copy may keep Outfit.
 */
export function MonoPrice({ cents, className, 'aria-label': ariaLabel }: MonoPriceProps) {
  const safe = typeof cents === 'number' && Number.isFinite(cents) ? cents : null;
  const text = safe === null ? '\u2014' : formatCents(safe);

  return (
    <span
      className={cn(
        'font-mono tabular-nums tracking-tight',
        className,
      )}
      aria-label={ariaLabel}
    >
      {text}
    </span>
  );
}
