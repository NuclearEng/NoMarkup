import type { MetadataRoute } from 'next';

const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';
// Server-side gateway origin for enumerating public entities. Falls back to the
// public API URL, then localhost for dev.
const API_URL =
  process.env['API_INTERNAL_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:8081';

interface IdRow {
  id?: string;
}

/** Best-effort fetch of public entity ids; returns [] if the gateway is
 *  unreachable (e.g. at build time) so the sitemap still renders the static
 *  routes rather than failing the build. */
async function fetchIds(path: string, key: string): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, IdRow[]>;
    const rows = data[key] ?? [];
    return rows.map((r) => r.id).filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/marketplace`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/jobs`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/providers`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/legal`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];

  const [listingIds, jobIds, providerIds] = await Promise.all([
    fetchIds('/api/v1/listings?page_size=1000', 'listings'),
    fetchIds('/api/v1/jobs?page_size=1000', 'jobs'),
    fetchIds('/api/v1/providers/search?page_size=1000', 'providers'),
  ]);

  const entityRoutes: MetadataRoute.Sitemap = [
    ...listingIds.map((id) => ({
      url: `${SITE_URL}/marketplace/${id}`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.7,
    })),
    ...jobIds.map((id) => ({
      url: `${SITE_URL}/jobs/${id}`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.6,
    })),
    ...providerIds.map((id) => ({
      url: `${SITE_URL}/providers/${id}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];

  return [...staticRoutes, ...entityRoutes];
}
