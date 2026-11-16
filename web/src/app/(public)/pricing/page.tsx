import type { Metadata } from 'next';

import { BUYER_PAYS_AGREED_PRICE } from '@/lib/constants';

import { PricingPageContent } from './PricingPageContent';

export const metadata: Metadata = {
  title: 'Fair Price Index — The Market Sets The Rate | NoMarkup',
  description:
    `See real market rates for home services by category and ZIP code. Based on completed jobs — transparent pricing, not the markup. ${BUYER_PAYS_AGREED_PRICE}`,
  openGraph: {
    title: 'Fair Price Index — Real Home Service Pricing | NoMarkup',
    description:
      'Transparent pricing from completed jobs. Plumbing, electrical, landscaping, and more — the market sets the rate.',
  },
};

export default function PricingPage() {
  return <PricingPageContent />;
}
