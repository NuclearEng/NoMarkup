'use client';

import Link from 'next/link';

import { useFeatureFlag } from '@/hooks/useFeatureFlags';

/**
 * Support-page mention of the legal-services marketplace. The route calls
 * notFound() unless `legal_services` is on, and iOS keeps that key hard-off,
 * so the link stays hidden until the flag is explicitly enabled.
 */
export function LegalServicesSupportLink() {
  const enabled = useFeatureFlag('legal_services');
  if (!enabled) return null;
  return (
    <>
      {' '}
      For legal marketplace services (hire an attorney via reverse auction), see{' '}
      <Link href="/legal">Legal Services</Link>. That is a product surface, not these policies.
    </>
  );
}
