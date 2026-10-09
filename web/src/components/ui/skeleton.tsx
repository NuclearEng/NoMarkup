import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'text' | 'circular' | 'card' | 'price';
  width?: string | number;
  height?: string | number;
}

function Skeleton({
  className,
  variant = 'default',
  width,
  height,
  style,
  ...props
}: SkeletonProps) {
  const variantClasses = {
    default: 'rounded-md',
    text: 'rounded h-4',
    circular: 'rounded-full aspect-square',
    card: 'rounded-xl',
    price: 'rounded-md tabular-nums',
  } as const;

  const sizeStyle: React.CSSProperties = {
    ...style,
    ...(width !== undefined
      ? { width: typeof width === 'number' ? `${String(width)}px` : width }
      : {}),
    ...(height !== undefined
      ? { height: typeof height === 'number' ? `${String(height)}px` : height }
      : {}),
  };

  // Champagne gold shimmer (showcase --gold #c9a84c) — terminal desk, not cold gray.
  const shimmer =
    variant === 'price'
      ? 'linear-gradient(90deg, transparent 0%, rgba(201,168,76,0.22) 50%, transparent 100%)'
      : 'linear-gradient(90deg, transparent 0%, rgba(201,168,76,0.14) 45%, rgba(255,255,255,0.06) 55%, transparent 100%)';

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-muted',
        variantClasses[variant],
        className,
      )}
      style={sizeStyle}
      role="presentation"
      aria-hidden="true"
      {...props}
    >
      <div
        className="absolute inset-0 motion-reduce:hidden"
        style={{
          background: shimmer,
          animation: 'shimmer-sweep 1.35s ease-in-out infinite',
        }}
        aria-hidden="true"
      />
    </div>
  );
}

export { Skeleton };
export type { SkeletonProps };
