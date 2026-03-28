'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';

import { AuctionSpectator } from '@/components/bids/AuctionSpectator';
import { useJob } from '@/hooks/useJobs';

export default function SpectatorPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const { data: job, isLoading, isError } = useJob(jobId);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="bg-muted h-8 w-2/3 animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-96 animate-pulse rounded-xl border" />
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center sm:px-6 lg:px-8">
        <h1 className="text-foreground text-2xl font-bold">Auction Not Found</h1>
        <p className="text-muted-foreground mt-2">
          This auction could not be found. It may have ended or been removed.
        </p>
        <Link
          href="/jobs"
          className="text-primary mt-4 inline-block text-sm font-medium hover:underline"
        >
          Browse all jobs
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <li>
            <Link href="/jobs" className="hover:text-foreground transition-colors">
              Jobs
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted-foreground/40">
            /
          </li>
          <li>
            <Link
              href={`/jobs/${jobId}`}
              className="hover:text-foreground transition-colors"
            >
              {job.title}
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted-foreground/40">
            /
          </li>
          <li className="text-foreground font-medium" aria-current="page">
            Live Spectator
          </li>
        </ol>
      </nav>

      <AuctionSpectator
        jobId={job.id}
        jobTitle={job.title}
        categoryName={job.category_name}
        auctionEndsAt={job.auction_ends_at}
        startingBidCents={job.starting_bid_cents}
      />

      {/* Share section */}
      <div className="mt-6 rounded-lg border border-border/50 bg-card p-4 text-center">
        <p className="text-muted-foreground text-sm">
          Share this live auction with friends
        </p>
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
            }}
            className="inline-flex items-center rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ minHeight: '44px', minWidth: '44px' }}
          >
            Copy Link
          </button>
        </div>
      </div>
    </div>
  );
}
