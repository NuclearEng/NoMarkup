import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Watch a Live Auction | NoMarkup',
  description:
    'Watch providers compete in real-time to offer the lowest price. See how much you could save on your next project with NoMarkup.',
  openGraph: {
    title: 'Watch a Live Auction on NoMarkup!',
    description:
      'Providers are competing right now to offer the lowest price. Watch the bidding war unfold in real-time.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Watch a Live Auction on NoMarkup!',
    description:
      'Providers are competing right now to offer the lowest price. Watch the bidding war unfold in real-time.',
  },
};

export default function SpectatorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
