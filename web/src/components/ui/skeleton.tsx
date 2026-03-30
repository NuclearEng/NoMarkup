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

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-muted',
        variantClasses[variant],
        className,
      )}
      style={sizeStyle}
      {...props}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)',
          animation: 'shimmer-sweep 1.5s ease-in-out infinite',
        }}
        aria-hidden="true"
      />
    </div>
  );
}

export { Skeleton };
export type { SkeletonProps };
