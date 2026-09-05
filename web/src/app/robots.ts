import type { MetadataRoute } from 'next';

const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';

/**
 * robots.txt — allow crawling of public surfaces, disallow authenticated app
 * sections and API. Points crawlers at the sitemap so the catalog is
 * discoverable (the marketplace's growth model is organic search).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/dashboard',
          '/admin',
          '/provider',
          '/settings',
          '/messages',
          '/payments',
          '/orders',
          '/contracts',
          '/bids',
          '/me/',
          '/profile',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
