'use client';

import { Scale } from 'lucide-react';

import {
  hasVerifiedBarLicense,
  useProviderLicenses,
} from '@/hooks/useProviderLicenses';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { cn } from '@/lib/utils';

interface VerifiedBarBadgeProps {
  /** The provider whose public licenses we check. */
  providerId: string;
  className?: string;
}

/**
 * VerifiedBarBadge renders a "Verified Bar Member" trust badge on a provider's
 * public profile when they have at least one VERIFIED bar license.
 *
 * Renders nothing when:
 *   - the `legal_services` feature flag is explicitly OFF, or
 *   - the provider has no verified bar license (loading, none, or pending).
 *
 * It fetches the provider's public (verified-only, last4) license projection
 * itself, so callers only need to pass the provider id.
 */
export function VerifiedBarBadge({ providerId, className }: VerifiedBarBadgeProps) {
  const legalEnabled = useFeatureFlag('legal_services');
  const { data: licenses } = useProviderLicenses(legalEnabled ? providerId : '');

  if (!legalEnabled) return null;
  if (!licenses || !hasVerifiedBarLicense(licenses)) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/10 px-2.5 py-1 text-xs font-medium text-[var(--brand-gold)]',
        className,
      )}
      aria-label="Verified bar member"
    >
      <Scale className="h-3 w-3" aria-hidden="true" />
      Verified Bar Member
    </span>
  );
}
