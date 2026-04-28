'use client';

import { Zap } from 'lucide-react';

import { cn } from '@/lib/utils';

interface SnipeExtensionBannerProps {
  /** Total number of times this auction has been extended */
  extensionCount: number;
  /** ISO timestamp of the new auction end (post-extension) */
  newEndTime: string;
  className?: string;
}

export function SnipeExtensionBanner({
  extensionCount,
  newEndTime,
  className,
}: SnipeExtensionBannerProps) {
  if (extensionCount <= 0) return null;

  const displayTime = new Date(newEndTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100',
        className,
      )}
    >
      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-amber-200">
          Auction extended
          {extensionCount > 1 ? ` (×${String(extensionCount)})` : ''}
        </p>
        <p className="mt-0.5 text-xs text-amber-100/80">
          A bid was placed in the final minutes — auction now ends at {displayTime}.
        </p>
      </div>
    </div>
  );
}
