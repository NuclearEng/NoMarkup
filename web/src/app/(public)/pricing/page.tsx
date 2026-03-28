import type { Metadata } from 'next';

import { PricingPageContent } from './PricingPageContent';

export const metadata: Metadata = {
  title: 'Fair Price Index — What Does Home Service Cost in Your Area? | NoMarkup',
  description:
    'See real market rates for home services by category and ZIP code. Based on actual completed jobs — no guesswork. Post your job on NoMarkup and save.',
  openGraph: {
    title: 'Fair Price Index — Real Home Service Pricing',
    description:
      'Transparent pricing data from completed jobs. See what homeowners actually pay for plumbing, electrical, landscaping, and more.',
  },
};

export default function PricingPage() {
  return <PricingPageContent />;
}
