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
const NEXT_IMAGE_ALLOWED_HOSTS = new Set<string>(['localhost', 'images.unsplash.com', 'picsum.photos']);

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

/**
 * Exact, transparent repayment progress for a paid-vs-owed bar (integer cents).
 *
 * Financial-accuracy rule (NoMarkup): the bar must NEVER claim "100%" / "paid in
 * full" while any balance remains. We therefore:
 *   - compute the exact ratio repaid/total in integer cents;
 *   - round the displayed percent DOWN (`Math.floor`), so e.g. 99.992% (8¢ short
 *     on a large advance) shows 99% — never a rounded-up 100%;
 *   - clamp the displayed percent to a maximum of 99 whenever `outstandingCents`
 *     is > 0, so it cannot read 100% with a balance still owed (a 99.6% raw ratio
 *     that floors to 99 is fine; a 99.999% ratio that would floor to 99 is fine,
 *     but a ratio that floors to 100 with cents left is forced back to 99);
 *   - only return `100` / `complete: true` when `outstandingCents === 0` exactly.
 *
 * `outstandingCents` is the authoritative remaining balance (total − repaid,
 * floored at 0) and is what should be surfaced to the user verbatim.
 */
export function repaymentProgress(
  repaidCents: number,
  totalOwedCents: number,
): { percent: number; outstandingCents: number; complete: boolean } {
  const total = Number.isFinite(totalOwedCents) ? Math.max(0, totalOwedCents) : 0;
  const repaid = Number.isFinite(repaidCents) ? Math.max(0, repaidCents) : 0;

  if (total <= 0) {
    // Nothing owed → nothing to repay; treat as complete with no balance.
    return { percent: 100, outstandingCents: 0, complete: true };
  }

  const outstandingCents = Math.max(0, total - repaid);
  const complete = outstandingCents === 0;

  if (complete) {
    return { percent: 100, outstandingCents: 0, complete: true };
  }

  // Round DOWN so we never overstate progress, and hard-cap at 99 while any
  // balance remains so the bar can never render as 100% with cents outstanding.
  const rawPercent = Math.floor((repaid / total) * 100);
  const percent = Math.min(99, Math.max(0, rawPercent));
  return { percent, outstandingCents, complete: false };
}

/**
 * Title-Case a machine status/enum value for display.
 *
 * Turns `snake_case` / `kebab-case` / `SCREAMING_SNAKE` machine values into a
 * human-readable label (`pending_payment` → "Pending Payment", `under_review`
 * → "Under Review"). This is the safe default for any status/enum we surface to
 * users when there is no curated copy for it — never render the raw slug.
 *
 * A nullish/empty input returns an empty string so callers can render it
 * directly without leaking `undefined`. Already-spaced input is preserved and
 * just re-cased word-by-word.
 */
export function humanizeStatus(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Friendly display names for subscription tiers.
 *
 * The payment service stores the tier `name` as a machine slug (`free`,
 * `pro_customer`, `pro_provider`) and the gateway passes it through verbatim,
 * so rendering `tier.name` directly leaks the slug to users. Map the known
 * slugs to curated copy; anything unknown falls back to a humanized form of the
 * slug (so a future tier still reads sensibly instead of raw snake_case).
 */
const SUBSCRIPTION_TIER_LABELS: Record<string, string> = {
  free: 'Free',
  pro_customer: 'Pro (Customer)',
  pro_provider: 'Pro (Provider)',
};

/**
 * Resolve a subscription tier's user-facing name. Prefer the `slug` (stable
 * machine key) for the lookup, falling back to `name` (which currently also
 * carries the slug). Unknown tiers degrade to a humanized label.
 */
export function subscriptionTierLabel(tier: {
  name?: string | null;
  slug?: string | null;
}): string {
  const key = (tier.slug ?? tier.name ?? '').trim();
  return SUBSCRIPTION_TIER_LABELS[key] ?? humanizeStatus(key);
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
