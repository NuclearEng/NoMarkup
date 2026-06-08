import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage, idempotencyHeader } from '@/lib/api';
import type {
  RequestInsuranceQuotesInput,
  InsuranceQuoteRequestResponse,
  InsuranceQuoteRequestDetail,
  SelectInsuranceQuoteResponse,
} from '@/types';

/**
 * Competitive insurance marketplace hooks.
 *
 * Flow: a customer requests quotes for a coverage amount + product type, the
 * gateway fans the request out to participating insurers, and returns the
 * competing offers (sorted cheapest-first). The customer compares and binds
 * exactly one — which mints a policy.
 *
 * Contract (mirrors the gateway routes — see PR description):
 *   POST /api/v1/insurance/quote-requests          → { request_id, quotes[] }
 *   GET  /api/v1/insurance/quote-requests/{id}      → { request, quotes[] }
 *   POST /api/v1/insurance/quote-requests/{id}/select { quote_id } → { policy_id, status }
 *
 * The whole surface is gated by the `insurance_competition` feature flag at the
 * UI layer; the gateway independently enforces it via RequireFlag.
 */

const QUOTE_REQUEST_KEY = (id: string) => ['insurance-quote-request', id] as const;

/**
 * Requests competing quotes from insurers for a given coverage amount.
 * Returns the request id plus the initial set of quotes (cheapest-first).
 */
export function useRequestQuotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RequestInsuranceQuotesInput) =>
      api.post<InsuranceQuoteRequestResponse>(
        '/api/v1/insurance/quote-requests',
        input,
        idempotencyHeader(),
      ),
    onSuccess: (data) => {
      // Seed the detail query so a subsequent GET (or the comparison view)
      // reads the quotes we already have without an extra round-trip.
      queryClient.setQueryData<InsuranceQuoteRequestDetail>(
        QUOTE_REQUEST_KEY(data.request_id),
        {
          request: {
            id: data.request_id,
            product_type: data.product_type ?? '',
            coverage_cents: data.coverage_cents ?? 0,
            contract_id: data.contract_id ?? null,
            status: data.status ?? 'open',
            created_at: data.created_at ?? new Date().toISOString(),
          },
          quotes: data.quotes,
        },
      );
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Could not request insurance quotes'));
    },
  });
}

/**
 * Reads a quote request and its competing quotes by id. Disabled until an id
 * exists (e.g. before the request has been created).
 */
export function useQuoteRequest(id: string | null | undefined) {
  return useQuery({
    queryKey: QUOTE_REQUEST_KEY(id ?? ''),
    queryFn: () =>
      api.get<InsuranceQuoteRequestDetail>(
        `/api/v1/insurance/quote-requests/${id ?? ''}`,
      ),
    enabled: !!id,
  });
}

/**
 * Binds the chosen insurer by selecting one of the competing quotes, minting a
 * policy. Invalidates the parent request so the comparison view reflects the
 * bound state.
 */
export function useSelectQuote(requestId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (quoteId: string) =>
      api.post<SelectInsuranceQuoteResponse>(
        `/api/v1/insurance/quote-requests/${requestId}/select`,
        { quote_id: quoteId },
        idempotencyHeader(),
      ),
    onSuccess: () => {
      toast.success('Policy bound — you are covered');
      void queryClient.invalidateQueries({ queryKey: QUOTE_REQUEST_KEY(requestId) });
      void queryClient.invalidateQueries({ queryKey: ['my-policies'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Could not bind this policy'));
    },
  });
}
