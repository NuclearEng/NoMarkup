import { cn } from '@/lib/utils';

/**
 * SpringBoard app-icon tile — same raster as iOS AppIcon-1024
 * (`brand/ICON_DECISION.md` champagne metal M↓).
 *
 * Prefer this for chrome brand (header, auth, empty/error). Use `BrandMark`
 * only when you need a monochrome currentColor monogram.
 *
 * Plain <img> from `/public` (not next/image) so SSR HTML and the client
 * tree match exactly — avoids hydration mismatches from optimizer attrs.
 */
export type AppIconSize = 'sm' | 'md' | 'lg' | 'xl';

interface AppIconProps {
  size?: AppIconSize;
  className?: string;
  /**
   * Accessible name. Empty string (default) when the parent already labels
   * the control (e.g. Logo link with aria-label).
   */
  alt?: string;
  /** Kept for Logo API compatibility; brand mark is tiny so always eager. */
  priority?: boolean;
}

/** Display pixels — md is large enough to read the metal tile in the nav. */
const sizePx: Record<AppIconSize, number> = {
  sm: 28,
  md: 32,
  lg: 56,
  xl: 80,
} as const;

/** Public asset — identical art to iOS AppIcon-1024. */
const APP_ICON_SRC = '/icons/icon-192.png';

export function AppIcon({
  size = 'md',
  className,
  alt = '',
  priority = false,
}: AppIconProps) {
  const px = sizePx[size];

  return (
    // eslint-disable-next-line @next/next/no-img-element -- intentional: local brand asset; next/image attrs caused SSR/client hydration drift under HMR
    <img
      src={APP_ICON_SRC}
      alt={alt}
      width={px}
      height={px}
      // String attrs only — keep SSR and client DOM identical
      decoding="async"
      // Eager for chrome brand when parent asks; otherwise browser default
      {...(priority ? { fetchPriority: 'high' as const } : {})}
      draggable={false}
      className={cn(
        'shrink-0 select-none object-cover',
        // iOS continuous corner ≈ 22.5% of side
        'rounded-[22.5%]',
        'ring-1 ring-white/15',
        size === 'lg' || size === 'xl' ? 'shadow-md shadow-black/40' : 'shadow-sm shadow-black/30',
        className,
      )}
    />
  );
}
