import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ChunkPlaceholderProps {
  /** Announced to assistive technology while the section's code loads. */
  label: string;
  /** Reserve the section's eventual height here (e.g. `min-h-[140px]`). */
  className?: string;
}

/**
 * Placeholder for a code-split section (`next/dynamic` `loading`).
 *
 * A polite status region with a text label, so the wait is announced, around a
 * skeleton that takes the height passed in `className`, so the content below
 * does not jump when the real section arrives.
 */
export function ChunkPlaceholder({ label, className }: ChunkPlaceholderProps) {
  return (
    <div role="status" className={cn('relative min-h-[140px] w-full', className)}>
      <Skeleton className="absolute inset-0 h-full w-full rounded-lg" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
