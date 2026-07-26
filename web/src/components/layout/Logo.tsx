import Link from 'next/link';

import { BrandMark } from '@/components/layout/BrandMark';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  asLink?: boolean;
  /** Hide the geometric mark (wordmark only). Default shows mark. */
  showMark?: boolean;
}

const sizeClasses = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-3xl',
} as const;

const markSizeClasses = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
} as const;

export function Logo({
  size = 'md',
  className = '',
  asLink = true,
  showMark = true,
}: LogoProps) {
  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-[var(--font-brand),sans-serif] font-extrabold -tracking-[0.02em]',
        sizeClasses[size],
        className,
      )}
    >
      {showMark ? (
        <BrandMark className={cn('shrink-0', markSizeClasses[size])} />
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
        href="/"
        className="inline-flex min-h-[44px] items-center text-foreground no-underline"
        aria-label="NoMarkup Home"
      >
        {content}
      </Link>
    );
  }

  return content;
}
