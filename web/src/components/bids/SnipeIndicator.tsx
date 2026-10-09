'use client';

import { Shield } from 'lucide-react';

interface SnipeIndicatorProps {
  count: number;
  max: number;
}

export function SnipeIndicator({ count, max }: SnipeIndicatorProps) {
  const isActive = count > 0;

  return (
    <div
      className="flex flex-col items-center gap-1.5"
      role="status"
      aria-live="polite"
      aria-label={
        isActive
          ? `Anti-snipe protection active: ${String(count)} of ${String(max)} extensions used`
          : `Anti-snipe protection available: 0 of ${String(max)} extensions used`
      }
    >
      {/* Shield icon + label */}
      <div className="flex items-center gap-1.5">
        <Shield
          className={`h-4 w-4 ${isActive ? 'text-trust-medium' : 'text-muted-foreground/50'}`}
          aria-hidden="true"
          fill={isActive ? 'currentColor' : 'none'}
        />
        <span
          className={`text-xs font-medium ${isActive ? 'text-trust-medium' : 'text-muted-foreground'}`}
        >
          {isActive ? 'Active' : 'Ready'}
        </span>
      </div>

      {/* Segment dots */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: max }, (_, i) => {
          const used = i < count;
          return (
            <div
              key={String(i)}
              className={`h-2.5 w-2.5 rounded-full border ${
                used
                  ? 'border-trust-medium bg-trust-medium'
                  : 'border-muted-foreground/30 bg-transparent'
              }`}
              style={
                used
                  ? { boxShadow: '0 0 6px rgba(251, 191, 36, 0.5)' }
                  : undefined
              }
            />
          );
        })}
      </div>

      {/* Micro label */}
      <span className="text-[10px] text-muted-foreground">
        {String(count)}/{String(max)} extensions
      </span>
    </div>
  );
}
