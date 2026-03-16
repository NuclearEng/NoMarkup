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
      className={`font-[var(--font-brand),sans-serif] font-extrabold tracking-tight ${sizeClasses[size]} ${className}`}
      style={{ letterSpacing: '-0.02em' }}
    >
      No
      <span style={{ color: 'var(--brand-gold)' }}>Markup</span>
    </span>
  );

  if (asLink) {
    return (
      <Link href="/" className="text-foreground no-underline" aria-label="NoMarkup Home">
        {content}
      </Link>
    );
  }

  return content;
}
