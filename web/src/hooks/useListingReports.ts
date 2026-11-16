// Listing abuse-report hook — posts to the public-ish listing report endpoint
// (optional auth). Reasons match the gateway CreateReport CHECK set
// (stolen|counterfeit|prohibited|misleading|spam|other). Sellers cannot
// report their own listing; the gateway returns 403 for that case.

import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const LISTING_REPORT_REASONS = [
  { value: 'stolen', label: 'Stolen goods' },
  { value: 'counterfeit', label: 'Counterfeit or fake' },
  { value: 'prohibited', label: 'Prohibited item' },
  { value: 'misleading', label: 'Misleading description' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
] as const;

export type ListingReportReason = (typeof LISTING_REPORT_REASONS)[number]['value'];

interface ReportListingInput {
  listingId: string;
  reason: ListingReportReason;
  description?: string;
}

interface ReportListingResponse {
  id?: string;
  status: string;
  message?: string;
}

export function useReportListing() {
  return useMutation({
    mutationFn: ({ listingId, reason, description }: ReportListingInput) =>
      api.post<ReportListingResponse>(`/api/v1/listings/${listingId}/report`, {
        reason,
        description: description ?? '',
      }),
  });
}
