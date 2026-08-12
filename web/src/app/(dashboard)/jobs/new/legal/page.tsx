import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalIntakeForm } from '@/components/forms/LegalIntakeForm';
import { serverFetch } from '@/lib/server-fetch';

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
 * Whether the `legal_services` flag is enabled. Fail-closed (SEC-02): any
 * error or missing key is treated as DISABLED — same as the legal landing
 * page. Gateway still RequireFlag on job-create; this only hides the intake.
 */
async function isLegalServicesEnabled(): Promise<boolean> {
  try {
    const res = await serverFetch(`${API_URL}/api/v1/flags`, { next: { revalidate: 60 } });
    if (!res.ok) return false;
    const flags = (await res.json()) as Record<string, boolean | undefined>;
    return flags['legal_services'] ?? false;
  } catch {
    return false;
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
