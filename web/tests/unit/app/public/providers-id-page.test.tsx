// `/providers/[id]` Server Component (page.tsx) — the async RSC entry, as
// opposed to the ProviderProfileClient island covered by providers-id.test.tsx.
// Asserts the upstream URL fetched, notFound() on every "no provider" shape,
// generateMetadata per branch, and the sanitised LocalBusiness JSON-LD.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicProvider } from '@/hooks/useProviders';

const serverFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/server-fetch', () => ({
  serverFetch: (url: string, init?: RequestInit) => serverFetch(url, init),
}));

const notFound = vi.fn<() => never>();
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

interface IslandProps {
  providerId: string;
  initialProvider: PublicProvider;
}

const islandProps: IslandProps[] = [];
vi.mock('@/app/(public)/providers/[id]/ProviderProfileClient', () => ({
  ProviderProfileClient: (props: IslandProps) => {
    islandProps.push(props);
    return createElement('div', { 'data-testid': 'provider-island' });
  },
}));

function makeProvider(overrides: Partial<PublicProvider> = {}): PublicProvider {
  return {
    id: 'prov-1',
    user_id: 'user-1',
    display_name: 'Pat Plumber',
    business_name: 'Pat & Sons Plumbing',
    avatar_url: 'https://cdn.example.com/pat.png',
    bio: 'Licensed plumber serving Seattle since 2009.',
    service_categories: [
      { id: 'cat-1', name: 'Plumbing' },
      { id: 'cat-2', name: 'Drain Cleaning' },
    ],
    trust_score: null,
    review_summary: { average_rating: 4.75, review_count: 12 } as PublicProvider['review_summary'],
    jobs_completed: 48,
    member_since: '2024-01-01T00:00:00Z',
    verified: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadPage() {
  vi.resetModules();
  return import('@/app/(public)/providers/[id]/page');
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** Render the RSC; returns the island props and the parsed JSON-LD block. */
async function renderPage(id: string): Promise<{
  island: IslandProps;
  rawLd: string;
  ld: Record<string, unknown>;
}> {
  const { default: ProviderProfilePage } = await loadPage();
  const element = await ProviderProfilePage(params(id));
  const { container } = render(element);
  expect(screen.getByTestId('provider-island')).toBeInTheDocument();
  const island = islandProps.at(-1);
  if (!island) throw new Error('ProviderProfileClient was not rendered');
  const script = container.querySelector('script[type="application/ld+json"]');
  if (!script) throw new Error('JSON-LD script was not rendered');
  const rawLd = script.innerHTML;
  return { island, rawLd, ld: JSON.parse(rawLd) as Record<string, unknown> };
}

async function metadataFor(id: string) {
  const { generateMetadata } = await loadPage();
  return generateMetadata(params(id));
}

beforeEach(() => {
  islandProps.length = 0;
  serverFetch.mockReset();
  serverFetch.mockResolvedValue(jsonResponse(makeProvider()));
  notFound.mockReset();
  notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  vi.stubEnv('API_URL', 'http://gateway.internal:8081');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/providers/[id] page — upstream fetch', () => {
  it('fetches the provider from the server-only API_URL with a 60s revalidate', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage('prov-1');
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch).toHaveBeenCalledWith('http://gateway.internal:8081/api/v1/providers/prov-1', {
      next: { revalidate: 60 },
    });
  });

  it('falls back to NEXT_PUBLIC_API_URL when API_URL is unset', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage('prov-9');
    expect(serverFetch.mock.calls[0]?.[0]).toBe('https://public.example.com/api/v1/providers/prov-9');
  });

  it('falls back to localhost when neither origin is set', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    await renderPage('prov-1');
    expect(serverFetch.mock.calls[0]?.[0]).toBe('http://localhost:8081/api/v1/providers/prov-1');
  });
});

describe('/providers/[id] page — rendering', () => {
  it('seeds the client island with the route id and the fetched provider', async () => {
    const provider = makeProvider();
    serverFetch.mockResolvedValue(jsonResponse(provider));
    const { island } = await renderPage('prov-1');
    expect(island).toEqual({ providerId: 'prov-1', initialProvider: provider });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('emits full LocalBusiness JSON-LD for a provider with bio, avatar, reviews and categories', async () => {
    const { ld } = await renderPage('prov-1');
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Pat & Sons Plumbing',
      url: 'https://site.example.com/providers/prov-1',
      description: 'Licensed plumber serving Seattle since 2009.',
      image: 'https://cdn.example.com/pat.png',
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 4.75,
        reviewCount: 12,
        bestRating: 5,
        worstRating: 1,
      },
      areaServed: ['Plumbing', 'Drain Cleaning'],
    });
  });

  it('omits every optional JSON-LD field for a bare profile and names it by display_name', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse(
        makeProvider({
          business_name: null,
          bio: null,
          avatar_url: null,
          review_summary: null,
          service_categories: [],
        }),
      ),
    );
    const { ld } = await renderPage('prov-1');
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Pat Plumber',
      url: 'https://site.example.com/providers/prov-1',
    });
  });

  it('omits aggregateRating when the review summary has zero reviews', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse(
        makeProvider({
          review_summary: {
            average_rating: 0,
            review_count: 0,
          } as PublicProvider['review_summary'],
        }),
      ),
    );
    const { ld } = await renderPage('prov-1');
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld['areaServed']).toEqual(['Plumbing', 'Drain Cleaning']);
  });

  it('escapes provider-controlled markup so it cannot close the script block', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse(makeProvider({ business_name: '</script><img src=x onerror=alert(1)>' })),
    );
    const { rawLd, ld } = await renderPage('prov-1');
    expect(rawLd).not.toContain('<');
    expect(rawLd).not.toContain('>');
    expect(rawLd).toContain('\\u003c/script\\u003e');
    // Still valid JSON that decodes back to the original name.
    expect(ld['name']).toBe('</script><img src=x onerror=alert(1)>');
  });

  it('uses the production origin for the canonical URL when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    const { ld } = await renderPage('prov-1');
    expect(ld['url']).toBe('https://no-markup.com/providers/prov-1');
  });
});

describe('/providers/[id] page — notFound()', () => {
  it.each<[string, () => void]>([
    [
      'a 404',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));
      },
    ],
    [
      'a 500',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
      },
    ],
    [
      'a 200 with a null body',
      () => {
        serverFetch.mockResolvedValue(jsonResponse(null));
      },
    ],
    [
      'a 200 body without an id',
      () => {
        serverFetch.mockResolvedValue(jsonResponse(makeProvider({ id: '' })));
      },
    ],
    [
      'a non-JSON body',
      () => {
        serverFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
      },
    ],
    [
      'a network error',
      () => {
        serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      },
    ],
  ])('calls notFound() and renders no island on %s', async (_label, arrange) => {
    arrange();
    const { default: ProviderProfilePage } = await loadPage();
    await expect(ProviderProfilePage(params('prov-missing'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(islandProps).toHaveLength(0);
  });
});

describe('/providers/[id] page — generateMetadata', () => {
  it('returns the not-found metadata when the provider cannot be fetched', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));
    const metadata = await metadataFor('prov-missing');
    expect(metadata).toEqual({
      title: 'Provider not found',
      description: 'This provider could not be found.',
    });
    expect(serverFetch.mock.calls[0]?.[0]).toBe(
      'http://gateway.internal:8081/api/v1/providers/prov-missing',
    );
  });

  it('uses the bio, business name, canonical URL and avatar image when present', async () => {
    const metadata = await metadataFor('prov-1');
    expect(metadata).toEqual({
      title: 'Pat & Sons Plumbing',
      description: 'Licensed plumber serving Seattle since 2009.',
      alternates: { canonical: '/providers/prov-1' },
      openGraph: {
        title: 'Pat & Sons Plumbing',
        description: 'Licensed plumber serving Seattle since 2009.',
        type: 'profile',
        url: 'https://site.example.com/providers/prov-1',
        images: [{ url: 'https://cdn.example.com/pat.png' }],
      },
    });
  });

  it('trims the bio and clamps it to 160 characters with an ellipsis', async () => {
    serverFetch.mockResolvedValue(jsonResponse(makeProvider({ bio: `  ${'a'.repeat(200)}  ` })));
    const metadata = await metadataFor('prov-1');
    expect(metadata.description).toBe(`${'a'.repeat(157)}...`);
    expect(metadata.description).toHaveLength(160);
  });

  it('keeps a bio of exactly 160 characters intact', async () => {
    serverFetch.mockResolvedValue(jsonResponse(makeProvider({ bio: 'b'.repeat(160) })));
    const metadata = await metadataFor('prov-1');
    expect(metadata.description).toBe('b'.repeat(160));
  });

  it('synthesises a description from rating, categories and job count when there is no bio', async () => {
    serverFetch.mockResolvedValue(jsonResponse(makeProvider({ bio: null })));
    const metadata = await metadataFor('prov-1');
    expect(metadata.description).toBe(
      'Rated 4.8 from 12 reviews. Services: Plumbing, Drain Cleaning. 48 jobs completed on NoMarkup.',
    );
  });

  it('uses the singular "review" for exactly one review', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse(
        makeProvider({
          bio: null,
          review_summary: {
            average_rating: 5,
            review_count: 1,
          } as PublicProvider['review_summary'],
        }),
      ),
    );
    const metadata = await metadataFor('prov-1');
    expect(metadata.description).toBe(
      'Rated 5.0 from 1 review. Services: Plumbing, Drain Cleaning. 48 jobs completed on NoMarkup.',
    );
  });

  it('drops the rating, services and image for a bare profile and titles it by display_name', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse(
        makeProvider({
          business_name: null,
          bio: null,
          avatar_url: null,
          review_summary: null,
          service_categories: [],
          jobs_completed: 0,
        }),
      ),
    );
    const metadata = await metadataFor('prov-1');
    expect(metadata.title).toBe('Pat Plumber');
    expect(metadata.description).toBe('0 jobs completed on NoMarkup.');
    expect(metadata.openGraph).toEqual({
      title: 'Pat Plumber',
      description: '0 jobs completed on NoMarkup.',
      type: 'profile',
      url: 'https://site.example.com/providers/prov-1',
    });
  });

  it('builds the Open Graph URL on the production origin when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    const metadata = await metadataFor('prov-1');
    expect(metadata.openGraph?.url).toBe('https://no-markup.com/providers/prov-1');
  });
});
