import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  /** Accessible label; omit or empty for decorative (aria-hidden). */
  title?: string;
}

/**
 * Geometric gold “N” inside dual concentric rings — app icon mark as pure SVG.
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
      {/* Outer ring */}
      <circle
        cx="16"
        cy="16"
        r="14.5"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.5"
      />
      {/* Inner ring — brighter gold via CSS var */}
      <circle
        cx="16"
        cy="16"
        r="11.25"
        stroke="var(--brand-gold-bright)"
        strokeWidth="1.5"
        opacity="0.95"
      />
      {/* Precision diamond (12 o’clock) — matches app icon seal */}
      <path
        d="M16 2.2 L17.35 3.7 L16 5.2 L14.65 3.7 Z"
        fill="var(--brand-gold-bright)"
        opacity="0.95"
      />
      {/* Geometric N */}
      <path
        d="M11 22.25V9.75h2.35l5.85 8.85V9.75H21.5v12.5h-2.35l-5.85-8.85v8.85H11z"
        fill="currentColor"
      />
    </svg>
  );
}
