import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
