import type { Metadata } from 'next';

import { LandingPageClient } from './LandingPageClient';

export const metadata: Metadata = {
  title: 'NoMarkup — The Market Sets The Price',
  description:
    'Reverse-auction service marketplace. Customers post jobs, providers compete on price. Fair market rates — not the markup. Plus local goods with escrow.',
  openGraph: {
    title: 'NoMarkup — The Market Sets The Price. Not The Markup.',
    description:
      'Customers post home-service jobs. Qualified providers compete in real-time reverse auctions. Prices drop to fair market rates.',
    type: 'website',
  },
};

/**
 * PERF-05: thin Server Component entry for `/`. Interactive UI lives in the
 * LandingPageClient island (client-only animations, AuctionDemo, IO). Root
 * layout still forces dynamic rendering via CSP nonce (`headers()`), but
 * keeping the route module as an RSC preserves the marketplace pattern and
 * lets us export static metadata here.
 */
export default function LandingPage() {
  return <LandingPageClient />;
}
