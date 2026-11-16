import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  /** Accessible label; omit or empty for decorative (aria-hidden). */
  title?: string;
}

/**
 * Monochrome M↓ monogram (SVG, currentColor) for tight / tinted contexts.
 * Primary chrome brand is the raster SpringBoard tile via `AppIcon` / `Logo`.
 * Spec: `brand/ICON_DECISION.md` champagne metal M↓.
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
      {/* Soft seal ring */}
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="7"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.45"
      />
      {/* Crystal M */}
      <path
        d="M8.5 23V9h3.1l3.15 9.2L17.9 9H21v14h-2.55v-9.1L15.2 23h-1.9l-3.25-9.1V23H8.5z"
        fill="currentColor"
      />
      {/* Down arrow — price / reverse auction */}
      <path
        d="M22.2 14.2 L25.5 18.8 L28.8 14.2"
        stroke="var(--brand-gold-bright)"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M25.5 11.2 V18.5"
        stroke="var(--brand-gold-bright)"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}
