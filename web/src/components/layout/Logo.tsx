import Link from 'next/link';
import type { Route } from 'next';

import { AppIcon, type AppIconSize } from '@/components/layout/AppIcon';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  asLink?: boolean;
  /** Override link target (default `/`). Header uses `/dashboard` when signed in. */
  href?: Route | string;
  /** Hide the app-icon tile (wordmark only). Default shows tile. */
  showMark?: boolean;
  /** Eager-load tile (auth hero, marketing). */
  priority?: boolean;
  /** Accessible name for the link (default "NoMarkup Home"). */
  ariaLabel?: string;
}

const sizeClasses = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-3xl',
} as const;

const markSize: Record<'sm' | 'md' | 'lg', AppIconSize> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
};

export function Logo({
  size = 'md',
  className = '',
  asLink = true,
  href = '/',
  showMark = true,
  priority = false,
  ariaLabel = 'NoMarkup Home',
}: LogoProps) {
  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-[var(--font-syne),var(--font-brand),sans-serif] font-extrabold -tracking-[0.02em]',
        sizeClasses[size],
        className,
      )}
    >
      {showMark ? (
        <AppIcon size={markSize[size]} priority={priority} alt="" />
      ) : null}
      <span>
        No
        <span className="gold-text">Markup</span>
      </span>
    </span>
  );

  if (asLink) {
    return (
      <Link
        href={href as Route}
        className="inline-flex min-h-[44px] items-center text-foreground no-underline"
        aria-label={ariaLabel}
      >
        {content}
      </Link>
    );
  }

  return content;
}
