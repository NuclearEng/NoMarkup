// Compliance hooks — cookie consent, age gate, ToS re-acceptance, and
// bid bond pre-auth. Pairs with gateway/internal/handler/compliance.go
// and gateway/internal/handler/bid_bonds.go.
//
// Surfaces:
//
//   - useLogCookieConsent()         — POST /api/v1/cookie-consent
//   - useCurrentToS()               — GET  /api/v1/tos/current
//   - useMyToSAcceptance()          — GET  /api/v1/me/tos-acceptance
//   - useAcceptToS()                — POST /api/v1/me/tos-acceptance
//   - useSetDOB()                   — PUT  /api/v1/me/dob
//   - useMyAgeStatus()              — GET  /api/v1/me/age-status
//   - useCreateBidBond()            — POST /api/v1/listings/{id}/bid-bond
//   - useConfirmBidBond()           — POST /api/v1/listings/{id}/bid-bond/confirm
//
// Cookie consent has a small cookie-write helper (`writeConsentCookie`)
// so the banner can hide on subsequent visits without re-querying the
// server. We never store consent state in localStorage — cookies are the
// canonical channel.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api, getApiErrorMessage } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface CookieConsentInput {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  session_id?: string;
}

export interface CookieConsentResponse {
  recorded: boolean;
}

export interface ToSVersion {
  version: string;
  effective_at: string;
  body_url: string | null;
}

export interface ToSAcceptanceStatus {
  tos_version: string | null;
  accepted_at: string | null;
}

export interface AgeStatus {
  verified: boolean;
  verified_at: string | null;
}

export interface CreateBidBondInput {
  intended_bid_cents: number;
}

export interface CreateBidBondResponse {
  bond_id: string;
  setup_intent_client_secret: string;
  bond_amount_cents: number;
}

export interface ConfirmBidBondResponse {
  authorized: boolean;
  bond_id: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Cookie consent
// ─────────────────────────────────────────────────────────────────────────

const CONSENT_COOKIE_NAME = 'nm:consent';
const CONSENT_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 12 months

/** True when the user has saved their consent on this device. */
export function hasConsentCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${CONSENT_COOKIE_NAME}=`));
}

/** Persist consent locally so the banner doesn't re-render every page. */
export function writeConsentCookie(input: CookieConsentInput): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(JSON.stringify(input));
  // SameSite=Lax + Secure (when serving over HTTPS) — the banner is part
  // of the auth boundary, so we treat it like a session preference cookie.
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE_NAME}=${value}; Max-Age=${String(CONSENT_COOKIE_MAX_AGE_S)}; Path=/; SameSite=Lax${secure}`;
}

export function useLogCookieConsent() {
  return useMutation({
    mutationFn: (input: CookieConsentInput) =>
      api.post<CookieConsentResponse>('/api/v1/cookie-consent', input),
    onError: () => {
      // Banner Save is best-effort — never block the user's session. We
      // intentionally swallow the error: the consent is already persisted
      // locally via writeConsentCookie, so a failed server-side audit log
      // has no user-facing impact and must not surface a toast or a
      // console line in production (§9/§13). The server logs its own 4xx/5xx.
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Terms of Service
// ─────────────────────────────────────────────────────────────────────────

export function useCurrentToS() {
  return useQuery({
    queryKey: ['tos', 'current'],
    queryFn: () => api.get<ToSVersion>('/api/v1/tos/current'),
    staleTime: 60 * 60 * 1000, // 1h — versions change rarely
  });
}

export function useMyToSAcceptance(enabled: boolean) {
  return useQuery({
    queryKey: ['tos', 'mine'],
    queryFn: () => api.get<ToSAcceptanceStatus>('/api/v1/me/tos-acceptance'),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useAcceptToS() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tosVersion: string) =>
      api.post<{ accepted: boolean; tos_version: string }>('/api/v1/me/tos-acceptance', {
        tos_version: tosVersion,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tos', 'mine'] });
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to record acceptance'));
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Age gate
// ─────────────────────────────────────────────────────────────────────────

export function useMyAgeStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['age-status'],
    queryFn: () => api.get<AgeStatus>('/api/v1/me/age-status'),
    enabled,
    staleTime: 24 * 60 * 60 * 1000, // 1 day
  });
}

export function useSetDOB() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dob: string) =>
      api.put<{ dob_verified: boolean }>('/api/v1/me/dob', { dob }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['age-status'] });
      toast.success('Age verified');
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to verify age'));
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Bid bond
// ─────────────────────────────────────────────────────────────────────────

export function useCreateBidBond() {
  return useMutation({
    mutationFn: ({ listingId, input }: { listingId: string; input: CreateBidBondInput }) =>
      api.post<CreateBidBondResponse>(`/api/v1/listings/${listingId}/bid-bond`, input),
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to create bid bond'));
    },
  });
}

export function useConfirmBidBond() {
  return useMutation({
    mutationFn: ({ listingId, bondId }: { listingId: string; bondId: string }) =>
      api.post<ConfirmBidBondResponse>(`/api/v1/listings/${listingId}/bid-bond/confirm`, {
        bond_id: bondId,
      }),
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to confirm bid bond'));
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 402 detection — extract bid-bond context from a place-bid 402 response.
// ─────────────────────────────────────────────────────────────────────────

export interface BidBondRequirement {
  requires_bid_bond: true;
  bond_amount_cents: number;
}

export function isBidBondRequirement(err: unknown): err is ApiError & {
  requirement: BidBondRequirement;
} {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 402) return false;
  try {
    const parsed = JSON.parse(err.body) as { requires_bid_bond?: boolean };
    return parsed.requires_bid_bond === true;
  } catch {
    return false;
  }
}

/** Pull the structured requirement out of a 402 ApiError. Returns null if absent. */
export function extractBidBondRequirement(err: unknown): BidBondRequirement | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 402) return null;
  try {
    const parsed = JSON.parse(err.body) as { requires_bid_bond?: boolean; bond_amount_cents?: number };
    if (parsed.requires_bid_bond === true && typeof parsed.bond_amount_cents === 'number') {
      return {
        requires_bid_bond: true,
        bond_amount_cents: parsed.bond_amount_cents,
      };
    }
  } catch {
    // not JSON
  }
  return null;
}
