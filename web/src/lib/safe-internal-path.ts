/**
 * Restrict post-login redirects to same-origin relative paths.
 * Rejects protocol-relative (`//evil`), absolute URLs, and empty values.
 */
export function safeInternalPath(
  raw: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (raw == null) return fallback;
  let value = raw.trim();
  if (value === '') return fallback;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw string when it is not URI-encoded.
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('://')) {
    return fallback;
  }
  return value;
}
