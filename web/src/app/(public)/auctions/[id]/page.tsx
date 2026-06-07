import { redirect } from 'next/navigation';

// A bare /auctions/{id} link should land on the job's live-auction view
// rather than 404. The services live-auction surface lives at /jobs/{id}.
export default async function AuctionRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/jobs/${id}`);
}
