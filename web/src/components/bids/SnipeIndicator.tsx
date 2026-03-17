'use client';

import { Clock } from 'lucide-react';

interface SnipeIndicatorProps {
  count: number;
  max: number;
}

export function SnipeIndicator({ count, max }: SnipeIndicatorProps) {
  if (count === 0) {
    return <p className="text-2xl font-bold text-muted-foreground">0/{String(max)}</p>;
  }

  return (
    <div
      className="flex items-center gap-2"
      role="status"
      aria-live="polite"
      aria-label={`Auction extended ${String(count)} of ${String(max)} times`}
    >
      <Clock className="h-5 w-5 animate-pulse text-amber-500" aria-hidden="true" />
      <p className="text-2xl font-bold text-amber-500">
        {String(count)}/{String(max)}
      </p>
    </div>
  );
}
