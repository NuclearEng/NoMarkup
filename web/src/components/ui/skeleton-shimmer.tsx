import { cn } from '@/lib/utils';

interface SkeletonShimmerProps {
  className?: string;
}

export function SkeletonShimmer({ className }: SkeletonShimmerProps) {
  return (
    <div className={cn('bg-muted relative overflow-hidden rounded-xl', className)}>
      <div
        className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
        style={{ backgroundSize: '200% 100%' }}
      />
    </div>
  );
}
