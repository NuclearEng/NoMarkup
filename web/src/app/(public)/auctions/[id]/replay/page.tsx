'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';

import { AuctionReplay } from '@/components/bids/AuctionReplay';
import { useAuctionReplay } from '@/hooks/useAuctionReplay';
import { formatCents } from '@/lib/utils';

export default function AuctionReplayPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const { data, isLoading, isError } = useAuctionReplay(jobId);

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

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center sm:px-6 lg:px-8">
        <h1 className="text-foreground text-2xl font-bold">Replay Not Available</h1>
        <p className="text-muted-foreground mt-2">
          This auction replay could not be found. It may not have completed yet or the data is
          unavailable.
        </p>
        <Link
          href={'/jobs' as Route}
          className="text-primary mt-4 inline-block text-sm font-medium hover:underline"
        >
          Browse all jobs
        </Link>
      </div>
    );
  }

  const durationMinutes = Math.floor(data.duration_seconds / 60);
  const durationSeconds = Math.floor(data.duration_seconds % 60);
  const durationLabel =
    durationMinutes > 0
      ? `${String(durationMinutes)}m ${String(durationSeconds)}s`
      : `${String(durationSeconds)}s`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <li>
            <Link href={'/jobs' as Route} className="hover:text-foreground transition-colors">
              Jobs
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted-foreground/40">
            /
          </li>
          <li>
            <Link
              href={`/jobs/${jobId}` as Route}
              className="hover:text-foreground transition-colors"
            >
              {data.job_title}
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted-foreground/40">
            /
          </li>
          <li className="text-foreground font-medium" aria-current="page">
            Auction Replay
          </li>
        </ol>
      </nav>

      {/* Job info header */}
      <div className="mb-6">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{data.job_title}</h1>
        {data.category ? (
          <p className="text-muted-foreground mt-1 text-sm">{data.category}</p>
        ) : null}
      </div>

      {/* Replay player */}
      <AuctionReplay jobId={jobId} />

      {/* Final stats card */}
      <div className="border-border/50 bg-card mt-6 rounded-xl border p-6 shadow-sm">
        <h2 className="text-foreground text-sm font-semibold uppercase tracking-wider">
          Auction Summary
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground text-xs">Starting Price</p>
            <p className="text-foreground mt-0.5 text-lg font-bold">
              {data.starting_bid_cents > 0 ? formatCents(data.starting_bid_cents) : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Winning Bid</p>
            <p className="mt-0.5 text-lg font-bold text-green-500">
              {data.winning_bid_cents > 0 ? formatCents(data.winning_bid_cents) : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Total Bids</p>
            <p className="text-foreground mt-0.5 text-lg font-bold">{String(data.bid_count)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Duration</p>
            <p className="text-foreground mt-0.5 text-lg font-bold">{durationLabel}</p>
          </div>
        </div>
        {data.total_savings_cents > 0 ? (
          <div className="mt-4 rounded-lg bg-green-500/10 p-3 text-center">
            <p className="text-sm font-bold text-green-500">
              Total Savings: {formatCents(data.total_savings_cents)}
            </p>
          </div>
        ) : null}
      </div>

      {/* Share section */}
      <div className="border-border/50 bg-card mt-6 rounded-lg border p-4 text-center">
        <p className="text-muted-foreground text-sm">Share this auction replay</p>
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
            }}
            className="bg-muted text-foreground hover:bg-muted/80 inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ minHeight: '44px', minWidth: '44px' }}
          >
            Copy Link
          </button>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-8 rounded-xl bg-gradient-to-r from-green-500/10 to-blue-500/10 p-6 text-center">
        <h3 className="text-foreground text-lg font-bold">Save on your next project</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Post a job and watch providers compete to offer you the best price.
        </p>
        <Link
          href={'/jobs' as Route}
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 inline-flex items-center rounded-md px-6 py-2.5 text-sm font-medium transition-colors"
          style={{ minHeight: '44px' }}
        >
          Post a Job
        </Link>
      </div>
    </div>
  );
}
