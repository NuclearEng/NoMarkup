/** The canonical origin for metadata, robots and the sitemap. */
export const DEFAULT_SITE_URL = 'https://no-markup.com';

/**
 * NEXT_PUBLIC_SITE_URL, or the default when it is unset OR empty.
 *
 * The web image sets `ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL`, so a build without that build
 * argument sees an empty string, not undefined. `?? default` kept the empty string and
 * `new URL('')` then failed the production build ("Failed to collect configuration for /_not-found:
 * Invalid URL").
 */
export function siteUrl(): string {
  const raw = process.env['NEXT_PUBLIC_SITE_URL'];
  return raw !== undefined && raw.trim() !== '' ? raw : DEFAULT_SITE_URL;
}
