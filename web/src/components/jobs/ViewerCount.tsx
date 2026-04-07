'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';

import { useViewerCount } from '@/hooks/useViewerCount';
import { cn } from '@/lib/utils';

interface ViewerCountProps {
  jobId: string;
  className?: string;
}

/**
 * Displays a live "N providers viewing now" badge using an amber colour scheme.
 * Only rendered when two or more viewers are active.
 * The count animates with a subtle scale pulse on each change.
 */
export function ViewerCount({ jobId, className }: ViewerCountProps) {
  const { count } = useViewerCount(jobId);
  const [isPulsing, setIsPulsing] = useState(false);
  const prevCount = useRef(count);

  // Trigger pulse animation whenever the count changes.
  useEffect(() => {
    if (prevCount.current !== count && count > 0) {
      prevCount.current = count;
      setIsPulsing(true);
      const timer = setTimeout(() => {
        setIsPulsing(false);
      }, 400);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [count]);

  // Only show the badge when more than one viewer is active.
  if (count <= 1) return null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full',
        'border border-amber-500/30 bg-amber-500/10 px-2.5 py-1',
        'text-xs font-medium text-amber-600 dark:text-amber-400',
        'transition-transform duration-300',
        isPulsing && 'scale-105',
        className,
      )}
      aria-live="polite"
      aria-label={`${String(count)} providers viewing now`}
    >
      <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {String(count)} provider{count !== 1 ? 's' : ''} viewing now
      </span>
    </div>
  );
}
