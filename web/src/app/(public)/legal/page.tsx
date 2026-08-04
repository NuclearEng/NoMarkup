import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import type { Job, JobsResponse } from '@/types';

import { LegalLandingClient } from './LegalLandingClient';
import { serverFetch } from '@/lib/server-fetch';

// Server-side API origin. Mirrors the marketplace page: prefer server-only
// API_URL, fall back to the public var, then localhost for dev. All reads here
// are public (no auth/cookies), so plain server fetches with a short revalidate.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

const EMPTY_JOBS: JobsResponse = {
  jobs: [],
  pagination: { totalCount: 0, page: 1, pageSize: 12, totalPages: 0, hasNext: false },
};

export const metadata: Metadata = {
  title: 'Legal Services · NoMarkup',
  description:
    'Post your legal need and let licensed attorneys compete in reverse auctions. Fair market rates — not the markup. Contracts, formation, wills, disputes.',
  openGraph: {
    title: 'Lawyers compete for your case · NoMarkup',
    description:
      'Licensed attorneys bid to win your legal work. Prices go down — the market sets the rate, not the markup.',
    type: 'website',
  },
};

// Minimal shape of a category-tree node from the public /categories/tree JSON.
interface RawCategoryNode {
  id: string;
  slug: string;
  children?: RawCategoryNode[] | null;
}

/**
 * resolveLegalCategoryId walks the public category tree and returns the id of
 * the node whose slug is `legal` — the root of the legal subtree. The jobs
 * search endpoint expands a parent id to its subtree (same as goods filtering),
 * so this one id drives both browse + the pre-filtered post-job CTA. Returns
 * null on any failure so the page still renders (it just shows all open jobs).
 */
async function resolveLegalCategoryId(): Promise<string | null> {
  try {
    const res = await serverFetch(`${API_URL}/api/v1/categories/tree`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { categories?: RawCategoryNode[] | null };

    function findLegal(nodes: RawCategoryNode[] | null | undefined): string | null {
      for (const node of nodes ?? []) {
        if (node.slug === 'legal') return node.id;
        const found = findLegal(node.children);
        if (found) return found;
      }
      return null;
    }

    return findLegal(body.categories);
  } catch {
    return null;
  }
}

/**
 * Whether the `legal_services` flag is enabled. Fail-closed (SEC-02): any
 * error or missing key is treated as DISABLED — mirrors useFeatureFlag for
 * financial/vertical flags. We only show the vertical when the backend
 * explicitly reports `true`.
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

/** Server-fetch the first page of open jobs in the legal subtree. */
async function fetchLegalJobs(categoryId: string | null): Promise<JobsResponse> {
  try {
    const params = new URLSearchParams({ page: '1', page_size: '12' });
    if (categoryId) params.set('category_ids', categoryId);
    const res = await serverFetch(`${API_URL}/api/v1/jobs?${params.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return EMPTY_JOBS;
    const body = (await res.json()) as {
      jobs?: Job[] | null;
      pagination?: JobsResponse['pagination'] | null;
    };
    return {
      jobs: body.jobs ?? [],
      pagination: body.pagination ?? EMPTY_JOBS.pagination,
    };
  } catch {
    return EMPTY_JOBS;
  }
}

export default async function LegalLandingPage() {
  const enabled = await isLegalServicesEnabled();
  // Flag explicitly off → the vertical doesn't exist for this market.
  if (!enabled) notFound();

  const legalCategoryId = await resolveLegalCategoryId();
  const initialJobs = await fetchLegalJobs(legalCategoryId);

  return <LegalLandingClient initialJobs={initialJobs} legalCategoryId={legalCategoryId} />;
}
