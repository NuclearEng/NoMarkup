import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Auction Replay | NoMarkup',
  description:
    'Watch how providers competed to offer the lowest price. See the full bidding timeline and how much the customer saved with NoMarkup.',
  openGraph: {
    title: 'Watch an Auction Replay on NoMarkup',
    description:
      'See how providers competed to offer the lowest price. Watch the full bidding timeline unfold.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Watch an Auction Replay on NoMarkup',
    description:
      'See how providers competed to offer the lowest price. Watch the full bidding timeline unfold.',
  },
};

export default function ReplayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
