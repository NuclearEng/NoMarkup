'use client';

import { Clock } from 'lucide-react';

interface SnipeIndicatorProps {
  count: number;
  max: number;
}

export function SnipeIndicator({ count, max }: SnipeIndicatorProps) {
  if (count === 0) {
    return <p className="text-xl font-bold text-muted-foreground sm:text-2xl">0/{String(max)}</p>;
  }

  return (
    <div
      className="flex items-center justify-center gap-1.5"
      role="status"
      aria-live="polite"
      aria-label={`Auction extended ${String(count)} of ${String(max)} times`}
    >
      <Clock className="h-4 w-4 animate-pulse text-amber-500" aria-hidden="true" />
      <p className="text-xl font-bold text-amber-500 sm:text-2xl">
        {String(count)}/{String(max)}
      </p>
    </div>
  );
}
