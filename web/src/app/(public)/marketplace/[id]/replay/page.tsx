'use client';

import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AuctionReplay } from '@/components/marketplace/AuctionReplay';
import { useListing } from '@/hooks/useListings';

export default function ListingReplayPage() {
  const params = useParams<{ id: string }>();
  const listingId = params.id;
  const { data: listing } = useListing(listingId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/marketplace/${listingId}` as Route}
        className="mb-4 inline-flex min-h-[44px] items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to listing
      </Link>

      <h1 className="mb-1 text-2xl font-bold tracking-tight text-zinc-100">
        Auction Replay
      </h1>
      {listing ? (
        <p className="mb-6 text-sm text-zinc-400">{listing.title}</p>
      ) : null}

      <AuctionReplay listingId={listingId} />
    </div>
  );
}
