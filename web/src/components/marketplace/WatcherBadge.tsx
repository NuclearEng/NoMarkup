'use client';

import { Eye } from 'lucide-react';

import { cn } from '@/lib/utils';

interface WatcherBadgeProps {
  count: number;
  className?: string;
}

/**
 * Live "47 watching" social-proof badge.
 *
 * The number is the engagement signal that distinguishes a NoMarkup auction
 * from a static marketplace listing. Bigger number → more competitive bid
 * environment → real-time price discovery is happening.
 */
export function WatcherBadge({ count, className }: WatcherBadgeProps) {
  if (count <= 0) return null;

  // Heat tier reflects how watched this auction is. 50+ is "trending".
  const tier =
    count >= 50 ? 'hot' : count >= 15 ? 'warm' : 'cool';

  const styles =
    tier === 'hot'
      ? 'bg-red-500/15 text-red-300 border-red-500/30'
      : tier === 'warm'
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        styles,
        className,
      )}
      aria-label={`${String(count)} people watching this auction`}
    >
      <Eye className="h-3 w-3" aria-hidden="true" />
      {count}
    </span>
  );
}
