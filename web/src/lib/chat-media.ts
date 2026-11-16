const MAX_CHAT_MEDIA_URL_LEN = 2000;

const FIXTURE_HOSTS = new Set(['images.unsplash.com', 'picsum.photos']);

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function isLoopbackHost(host: string): boolean {
  const h = normalizeHost(host);
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** `/<bucket>/<key>` — loopback MinIO paths, not a bare `http://localhost:9000/`. */
function looksLikeObjectStoragePath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  const bucket = parts[0];
  if (parts.length < 2 || !bucket) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bucket);
}

function hostFromMaybeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = normalizeHost(url.hostname);
    return host || null;
  } catch {
    return null;
  }
}

function extraAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const s3 = process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (s3) {
    const host = hostFromMaybeUrl(s3);
    if (host) hosts.add(host);
  }
  if (typeof window !== 'undefined' && window.location.hostname) {
    hosts.add(normalizeHost(window.location.hostname));
  }
  return hosts;
}

/**
 * True when `raw` is an upload-pipeline (or fixture) URL we are willing to
 * render as an image or file link. Mirrors gateway AllowedChatMediaURL.
 */
export function isAllowedChatMediaUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CHAT_MEDIA_URL_LEN) return false;
  if (/[\s<>]/.test(trimmed)) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  const host = normalizeHost(url.hostname);
  if (!host) return false;
  if (url.username || url.password) return false;

  const extra = extraAllowedHosts();
  const allowed = isLoopbackHost(host) || FIXTURE_HOSTS.has(host) || extra.has(host);
  if (!allowed) return false;

  if (scheme === 'https') {
    if (isLoopbackHost(host) && !looksLikeObjectStoragePath(url.pathname)) {
      return false;
    }
    return true;
  }
  if (scheme === 'http') {
    if (isLoopbackHost(host)) {
      return looksLikeObjectStoragePath(url.pathname);
    }
    // Dev MinIO / page origin may be http (LAN IP from NEXT_PUBLIC_S3_PUBLIC_URL).
    return extra.has(host);
  }
  return false;
}
