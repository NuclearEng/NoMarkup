import type { Metadata } from 'next';

import { PricingPageContent } from './PricingPageContent';

export const metadata: Metadata = {
  title: 'Fair Price Index — The Market Sets The Rate | NoMarkup',
  description:
    'See real market rates for home services by category and ZIP code. Based on completed jobs — transparent pricing, not the markup.',
  openGraph: {
    title: 'Fair Price Index — Real Home Service Pricing | NoMarkup',
    description:
      'Transparent pricing from completed jobs. Plumbing, electrical, landscaping, and more — the market sets the rate.',
  },
};

export default function PricingPage() {
  return <PricingPageContent />;
}
