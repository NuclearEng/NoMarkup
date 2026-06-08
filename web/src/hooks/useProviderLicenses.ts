import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';

/**
 * Professional-license capture for the LEGAL services vertical.
 *
 * Providers who practice law submit a bar (or other professional) license, which
 * the backend verifies out-of-band. The verified state powers a "Verified Bar
 * Member" trust badge on the public provider profile.
 *
 * Backend contract (built in parallel — see the legal vertical spec):
 *   POST /api/v1/providers/me/licenses    submit a license (status → pending)
 *   GET  /api/v1/providers/me/licenses    my licenses (full detail)
 *   GET  /api/v1/providers/{id}/licenses  another provider's VERIFIED licenses
 *                                         (public-safe projection, last4 only)
 */

/** Known license types. `bar` is the only one the legal vertical submits today;
 *  kept as a const-object enum so the contract can grow additively (notary,
 *  CPA, etc.) without a breaking change. */
export const LICENSE_TYPE = {
  BAR: 'bar',
} as const;

export type LicenseType = (typeof LICENSE_TYPE)[keyof typeof LICENSE_TYPE];

/** Verification lifecycle reported by the backend. */
export const LICENSE_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
} as const;

export type LicenseStatus = (typeof LICENSE_STATUS)[keyof typeof LICENSE_STATUS];

/** A provider's own license, as returned by GET /providers/me/licenses. */
export interface ProviderLicense {
  id: string;
  license_type: LicenseType;
  license_number: string;
  jurisdiction: string;
  status: LicenseStatus;
  created_at?: string;
  updated_at?: string;
  /** Optional admin/automated note explaining a rejection. */
  rejection_reason?: string | null;
}

/**
 * Public-safe license projection from GET /providers/{id}/licenses. The full
 * license_number is never exposed publicly — only the last 4 — and only
 * verified licenses are returned.
 */
export interface PublicProviderLicense {
  license_type: LicenseType;
  jurisdiction: string;
  status: LicenseStatus;
  last4: string;
}

export interface SubmitLicenseInput {
  license_type: LicenseType;
  license_number: string;
  jurisdiction: string;
}

const MY_LICENSES_KEY = ['providerLicenses', 'me'] as const;

/**
 * useMyLicenses returns the authenticated provider's submitted licenses with
 * full detail (including status). Returns an empty list — not an error — when
 * the provider has none yet so the capture UI can render its empty state.
 */
export function useMyLicenses() {
  return useQuery({
    queryKey: MY_LICENSES_KEY,
    queryFn: async (): Promise<ProviderLicense[]> => {
      try {
        const res = await api.get<{ licenses: ProviderLicense[] | null }>(
          '/api/v1/providers/me/licenses',
        );
        return res.licenses ?? [];
      } catch (err) {
        // No provider profile / no licenses yet → treat as empty, not a crash.
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
      }
    },
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
  });
}

/**
 * useSubmitLicense submits a new professional license for verification. On
 * success it refreshes the provider's own license list so the new pending entry
 * appears immediately. Surfaces the gateway's real error message on failure.
 */
export function useSubmitLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SubmitLicenseInput) =>
      api.post<ProviderLicense>('/api/v1/providers/me/licenses', input),
    onSuccess: () => {
      toast.success('License submitted for verification');
      void queryClient.invalidateQueries({ queryKey: MY_LICENSES_KEY });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        toast.error(err.userMessage('Could not submit license'));
        return;
      }
      toast.error('Could not submit license');
    },
  });
}

/**
 * useProviderLicenses returns another provider's publicly visible (verified)
 * licenses. Used by the VerifiedBarBadge on the public profile. Public read, so
 * it skips auth headers. Disabled until an id is available.
 */
export function useProviderLicenses(providerId: string) {
  return useQuery({
    queryKey: ['providerLicenses', providerId],
    queryFn: async (): Promise<PublicProviderLicense[]> => {
      try {
        const res = await api.getPublic<{ licenses: PublicProviderLicense[] | null }>(
          `/api/v1/providers/${providerId}/licenses`,
        );
        return res.licenses ?? [];
      } catch (err) {
        // A provider with no licenses simply has no badge — never surface an error.
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
      }
    },
    enabled: !!providerId,
  });
}

/**
 * hasVerifiedBarLicense is a small derived helper used by the badge: true when
 * the provider has at least one verified `bar` license.
 */
export function hasVerifiedBarLicense(licenses: PublicProviderLicense[]): boolean {
  return licenses.some(
    (l) => l.license_type === LICENSE_TYPE.BAR && l.status === LICENSE_STATUS.VERIFIED,
  );
}
