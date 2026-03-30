import { cn } from '@/lib/utils';

import { Skeleton } from './skeleton';

type LoaderPreset =
  | 'job-card'
  | 'bid-card'
  | 'stat-card'
  | 'message'
  | 'profile'
  | 'auction-arena'
  | 'contract-card';

interface ContentLoaderProps {
  preset: LoaderPreset;
  count?: number;
  className?: string;
}

function JobCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      {/* Title + status badge */}
      <div className="flex items-start justify-between gap-2">
        <Skeleton variant="text" className="h-5 w-3/4" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      {/* Category */}
      <div className="flex items-center gap-2">
        <Skeleton variant="circular" className="h-3.5 w-3.5" />
        <Skeleton variant="text" className="h-3.5 w-28" />
      </div>
      {/* Location */}
      <div className="flex items-center gap-2">
        <Skeleton variant="circular" className="h-3.5 w-3.5" />
        <Skeleton variant="text" className="h-3.5 w-40" />
      </div>
      {/* Price + bid count row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" className="h-3.5 w-3.5" />
          <Skeleton variant="text" className="h-3.5 w-16" />
        </div>
        <Skeleton variant="price" className="h-4 w-20" />
      </div>
      {/* Bottom row */}
      <div className="flex items-center justify-between border-t pt-3">
        <Skeleton variant="text" className="h-3.5 w-24" />
        <Skeleton variant="text" className="h-3 w-14" />
      </div>
    </div>
  );
}

function BidCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      {/* Avatar + name */}
      <div className="flex items-start gap-3">
        <Skeleton variant="circular" className="h-11 w-11" />
        <div className="flex-1 space-y-1.5">
          <Skeleton variant="text" className="h-4 w-32" />
          <Skeleton variant="text" className="h-3 w-24" />
        </div>
      </div>
      {/* Price */}
      <div className="flex items-baseline justify-between">
        <Skeleton variant="price" className="h-7 w-28" />
        <Skeleton variant="text" className="h-3 w-16" />
      </div>
      {/* Trust bar */}
      <div className="rounded-lg border bg-muted/40 p-3">
        <div className="flex items-center gap-3">
          <Skeleton variant="circular" className="h-11 w-11" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton variant="text" className="h-3 w-16" />
            </div>
            <Skeleton variant="text" className="h-3 w-full" />
          </div>
        </div>
      </div>
      {/* Action button */}
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex items-center justify-between pb-2">
        <Skeleton variant="text" className="h-3.5 w-24" />
        <Skeleton variant="circular" className="h-4 w-4" />
      </div>
      <Skeleton variant="price" className="mt-2 h-8 w-24" />
      <Skeleton variant="text" className="mt-2 h-3 w-32" />
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="space-y-4 py-3">
      {/* Left-aligned message */}
      <div className="flex items-start gap-2">
        <Skeleton variant="circular" className="h-8 w-8" />
        <div className="space-y-1">
          <Skeleton variant="text" className="h-3 w-20" />
          <Skeleton className="h-12 w-56 rounded-lg" />
        </div>
      </div>
      {/* Right-aligned message */}
      <div className="flex flex-row-reverse items-start gap-2">
        <Skeleton variant="circular" className="h-8 w-8" />
        <div className="flex flex-col items-end space-y-1">
          <Skeleton variant="text" className="h-3 w-16" />
          <Skeleton className="h-16 w-44 rounded-lg" />
        </div>
      </div>
      {/* Left-aligned shorter */}
      <div className="flex items-start gap-2">
        <Skeleton variant="circular" className="h-8 w-8" />
        <div className="space-y-1">
          <Skeleton variant="text" className="h-3 w-20" />
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      {/* Avatar + name */}
      <div className="flex items-center gap-4">
        <Skeleton variant="circular" className="h-20 w-20" />
        <div className="space-y-2">
          <Skeleton variant="text" className="h-6 w-40" />
          <Skeleton variant="text" className="h-4 w-28" />
        </div>
      </div>
      {/* Detail lines */}
      <div className="space-y-3">
        <Skeleton variant="text" className="h-4 w-full" />
        <Skeleton variant="text" className="h-4 w-5/6" />
        <Skeleton variant="text" className="h-4 w-4/6" />
      </div>
      {/* Action buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-28 rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
    </div>
  );
}

function AuctionArenaSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header banner */}
      <div className="bg-muted/60 px-6 py-3">
        <div className="flex items-center justify-between">
          <Skeleton variant="text" className="h-4 w-28" />
          <Skeleton variant="text" className="h-3 w-12" />
        </div>
      </div>
      {/* Hero price */}
      <div className="px-6 pt-6 pb-4 text-center space-y-2">
        <Skeleton variant="text" className="mx-auto h-3 w-24" />
        <Skeleton variant="price" className="mx-auto h-12 w-44" />
        <Skeleton variant="text" className="mx-auto h-3 w-20" />
      </div>
      {/* Stats row */}
      <div className="mx-6 mb-4 grid grid-cols-3 gap-px rounded-lg border bg-muted/20 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card flex flex-col items-center gap-1 px-3 py-3">
            <Skeleton variant="text" className="h-2.5 w-12" />
            <Skeleton variant="price" className="h-7 w-16" />
          </div>
        ))}
      </div>
      {/* Bid list */}
      <div className="px-6 pb-4 space-y-2">
        <Skeleton variant="text" className="h-3 w-20" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton variant="circular" className="h-6 w-6" />
            <Skeleton variant="text" className="h-3.5 flex-1" />
            <Skeleton variant="price" className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      {/* Title + status badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" className="h-4 w-4" />
          <Skeleton variant="text" className="h-5 w-32" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      {/* Amount + payment timing */}
      <div className="flex items-baseline justify-between">
        <Skeleton variant="price" className="h-7 w-28" />
        <Skeleton variant="text" className="h-3.5 w-24" />
      </div>
      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between">
          <Skeleton variant="text" className="h-3 w-16" />
          <Skeleton variant="text" className="h-3 w-20" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
      {/* Job reference */}
      <Skeleton variant="text" className="h-3 w-40" />
    </div>
  );
}

const PRESET_MAP: Record<LoaderPreset, () => React.JSX.Element> = {
  'job-card': JobCardSkeleton,
  'bid-card': BidCardSkeleton,
  'stat-card': StatCardSkeleton,
  'message': MessageSkeleton,
  'profile': ProfileSkeleton,
  'auction-arena': AuctionArenaSkeleton,
  'contract-card': ContractCardSkeleton,
};

function ContentLoader({ preset, count = 1, className }: ContentLoaderProps) {
  const Component = PRESET_MAP[preset];

  return (
    <div className={cn(className)} role="status" aria-label="Loading content">
      {Array.from({ length: count }).map((_, i) => (
        <Component key={`loader-${preset}-${String(i)}`} />
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export { ContentLoader };
export type { ContentLoaderProps, LoaderPreset };
