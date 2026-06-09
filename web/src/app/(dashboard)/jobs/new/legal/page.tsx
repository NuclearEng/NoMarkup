import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalIntakeForm } from '@/components/forms/LegalIntakeForm';

// Server-side API origin. Mirrors the legal landing page: prefer server-only
// API_URL, fall back to the public var, then localhost for dev.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

export const metadata: Metadata = {
  title: 'Post a legal job · NoMarkup',
  description:
    'Describe your legal matter and let verified, licensed attorneys compete on price.',
};

/**
 * Whether the `legal_services` flag is enabled. Fail-open: any error or missing
 * key is treated as ENABLED (mirrors the landing page + useFeatureFlag) — we
 * only hide the intake when the backend explicitly reports `false`. The gateway
 * independently enforces the flag on the job-create path, so an optimistic
 * `true` here cannot bypass an actually-disabled vertical.
 */
async function isLegalServicesEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/v1/flags`, { next: { revalidate: 60 } });
    if (!res.ok) return true;
    const flags = (await res.json()) as Record<string, boolean | undefined>;
    return flags['legal_services'] ?? true;
  } catch {
    return true;
  }
}

interface LegalPostPageProps {
  // Allow an optional deep-linked matter type, e.g. ?matter=<categoryId>.
  searchParams: Promise<{ matter?: string }>;
}

export default async function LegalPostPage({ searchParams }: LegalPostPageProps) {
  const enabled = await isLegalServicesEnabled();
  // Flag explicitly off → the vertical doesn't exist for this market.
  if (!enabled) notFound();

  const { matter } = await searchParams;

  return <LegalIntakeForm presetMatterCategoryId={matter} />;
}
