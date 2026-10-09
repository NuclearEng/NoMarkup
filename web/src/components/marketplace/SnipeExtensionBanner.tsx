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
        'flex items-start gap-3 rounded-xl border border-trust-medium/30 bg-trust-medium/10 p-3 text-sm text-trust-medium',
        className,
      )}
    >
      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-trust-medium" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-trust-medium">
          Auction extended
          {extensionCount > 1 ? ` (×${String(extensionCount)})` : ''}
        </p>
        <p className="mt-0.5 text-xs text-trust-medium/80">
          A bid was placed in the final minutes — auction now ends at {displayTime}.
        </p>
      </div>
    </div>
  );
}
