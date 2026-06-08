import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Hostnames that `next/image` is allowed to optimize. MUST stay in sync with
 * the `images.remotePatterns` allowlist in `next.config.ts` — `next/image`
 * THROWS synchronously during render for any other host ("Invalid src prop …
 * hostname not configured"), which crashes the whole React tree up to the
 * root error boundary. We mirror the list here so a stray/seed photo URL
 * (e.g. dev fixtures pointing at images.unsplash.com) degrades to the photo
 * placeholder instead of nuking the page (CLAUDE.md §15: fail soft).
 */
const NEXT_IMAGE_ALLOWED_HOSTS = new Set<string>(['localhost']);

/**
 * True when `src` is something `next/image` can render without throwing:
 * a relative/path-only URL, a data URI, or an absolute URL whose host is in
 * the `next.config.ts` remote-pattern allowlist. Use this to gate `<Image>`
 * so an unconfigured remote host falls back to a placeholder rather than
 * crashing the render. Returns false for null/undefined/empty.
 */
export function canNextImageLoad(src: string | null | undefined): boolean {
  if (!src) return false;
  // Relative paths and data URIs are always safe for next/image.
  if (src.startsWith('/') || src.startsWith('data:')) return true;
  try {
    const { hostname } = new URL(src);
    return NEXT_IMAGE_ALLOWED_HOSTS.has(hostname);
  } catch {
    // Not a parseable absolute URL — let next/image's own handling apply.
    return false;
  }
}

export function formatCents(cents: number | null | undefined): string {
  const safe = Number.isFinite(cents) ? (cents as number) : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(safe / 100);
}

/**
 * True when a pending-acceptance contract's deadline has already passed.
 *
 * The acceptance window is closed when the contract is still awaiting
 * acceptance (`pending_acceptance`) AND its `acceptance_deadline` is in the
 * past. The reference time is passed in (not read via `new Date()` here) so
 * callers control hydration safety — see `useAcceptanceExpired`. A missing /
 * unparseable deadline is treated as not-expired (fail open to the live UI;
 * the backend remains the source of truth).
 */
export function isAcceptanceExpired(
  status: string,
  acceptanceDeadline: string | null | undefined,
  nowMs: number,
): boolean {
  if (status !== 'pending_acceptance') return false;
  if (!acceptanceDeadline) return false;
  const deadlineMs = new Date(acceptanceDeadline).getTime();
  if (!Number.isFinite(deadlineMs)) return false;
  return deadlineMs < nowMs;
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;
  if (diffHours < 24) return `${String(diffHours)}h ago`;
  if (diffDays < 30) return `${String(diffDays)}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
