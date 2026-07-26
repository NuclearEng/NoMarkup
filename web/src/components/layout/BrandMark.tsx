import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  /** Accessible label; omit or empty for decorative (aria-hidden). */
  title?: string;
}

/**
 * Terminal monogram — bold gold **N** + downward chevron (reverse auction / price down).
 * Matches app icon master 37 (`brand/ICON_DECISION.md`), not jewelry dual-ring seal.
 * Colors via currentColor / brand CSS vars only (no raw hex).
 */
export function BrandMark({ className, title }: BrandMarkProps) {
  const decorative = title == null || title === '';

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('text-brand-gold', className)}
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {/* Geometric N — thick strokes for small sizes */}
      <path
        d="M9 24V8h2.6l7.2 11.4V8H23v16h-2.6l-7.2-11.4V24H9z"
        fill="currentColor"
      />
      {/* Down chevron — reverse auction / costs down (showcase product signal) */}
      <path
        d="M12 25.5 L16 28.5 L20 25.5"
        stroke="var(--brand-gold-bright)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
