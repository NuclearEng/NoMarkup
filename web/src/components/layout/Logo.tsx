import Link from 'next/link';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  asLink?: boolean;
}

const sizeClasses = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-3xl',
} as const;

export function Logo({ size = 'md', className = '', asLink = true }: LogoProps) {
  const content = (
    <span
      className={`font-[var(--font-brand),sans-serif] font-extrabold -tracking-[0.02em] ${sizeClasses[size]} ${className}`}
    >
      No
      <span className="text-[var(--brand-gold)]">Markup</span>
    </span>
  );

  if (asLink) {
    return (
      <Link href="/" className="inline-flex min-h-[44px] items-center text-foreground no-underline" aria-label="NoMarkup Home">
        {content}
      </Link>
    );
  }

  return content;
}
