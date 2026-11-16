import { buildOutboundTraceHeaders } from '@/lib/otel/trace-context';

/**
 * Server-side fetch that stamps the same outbound correlation headers the
 * browser client sends (`X-Request-ID` + W3C `traceparent`). Use on RSC
 * `page.tsx` / `generateMetadata` public API reads so gateway logs join the
 * trace of the first HTML paint.
 *
 * Preserves Next.js `next: { revalidate }` and any caller headers; does not
 * override an explicit RequestId already set by the caller.
 */
export async function serverFetch(
  input: string | URL,
  init?: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } },
): Promise<Response> {
  const outbound = buildOutboundTraceHeaders();
  const headers = new Headers(init?.headers);
  if (!headers.has('X-Request-ID') && !headers.has('x-request-id')) {
    headers.set('X-Request-ID', outbound['X-Request-ID']);
  }
  if (!headers.has('traceparent')) {
    headers.set('traceparent', outbound.traceparent);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}
