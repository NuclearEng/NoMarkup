import type { Metadata } from 'next';

import { LandingPageClient } from './LandingPageClient';

export const metadata: Metadata = {
  title: 'NoMarkup — fair prices, no lead-gen markup',
  description:
    'Reverse-auction marketplace for home services. Providers compete on price — no lead-gen markup. Plus a local goods marketplace with escrow and verified sellers.',
  openGraph: {
    title: 'NoMarkup — fair prices, no lead-gen markup',
    description:
      'Post a job and let verified providers compete on price. Plus a local goods marketplace with escrow.',
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
