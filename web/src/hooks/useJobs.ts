import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type {
  CreateJobInput,
  Job,
  JobDetail,
  JobsResponse,
  SearchJobsParams,
  UpdateJobInput,
} from '@/types';

// Job mutation handlers in the gateway return the job at the top level
// (not wrapped in { job }). Centralized unwrap so hooks keep their { job }
// contract-shaped return type.
async function postJob(path: string, input?: unknown): Promise<Job> {
  const raw = await api.post<Record<string, unknown>>(path, input);
  return raw as unknown as Job;
}

async function patchJob(path: string, input: unknown): Promise<Job> {
  const raw = await api.patch<Record<string, unknown>>(path, input);
  return raw as unknown as Job;
}

function explainFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

function buildSearchParams(params: SearchJobsParams): string {
  const searchParams = new URLSearchParams();
  // Parameter names must match what the Go gateway handler reads from r.URL.Query()
  if (params.category_id) searchParams.set('category_ids', params.category_id);
  if (params.query) searchParams.set('q', params.query);
  if (params.schedule_type) searchParams.set('schedule_type', params.schedule_type);
  if (params.is_recurring !== undefined && params.is_recurring)
    searchParams.set('recurring_only', 'true');
  if (params.min_price_cents !== undefined)
    searchParams.set('min_price_cents', String(params.min_price_cents));
  if (params.max_price_cents !== undefined)
    searchParams.set('max_price_cents', String(params.max_price_cents));
  if (params.location_lat !== undefined) searchParams.set('latitude', String(params.location_lat));
  if (params.location_lng !== undefined) searchParams.set('longitude', String(params.location_lng));
  if (params.radius_km !== undefined) searchParams.set('radius_km', String(params.radius_km));
  // Note: status is not sent — the backend always returns active jobs for public search
  if (params.sort_by) searchParams.set('sort', params.sort_by);
  if (params.sort_order) searchParams.set('sort_dir', params.sort_order);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export function useSearchJobs(
  params: SearchJobsParams,
  options?: { initialData?: JobsResponse },
) {
  return useQuery({
    queryKey: ['jobs', 'search', params],
    // Use getPublic to skip auth headers and the 401 retry/redirect cycle.
    // GET /api/v1/jobs is a public endpoint — attaching an auth token is
    // unnecessary and creates a race with AuthRestorer's token refresh that
    // can leave providers stuck in a permanent loading state.
    queryFn: () => api.getPublic<JobsResponse>(`/api/v1/jobs${buildSearchParams(params)}`),
    // Keep the previous page of results visible while fetching the next page
    // or during background refetches so the skeleton loader never reappears.
    placeholderData: keepPreviousData,
    // Optional server-seeded first page (RSC pages pass their fetch result) so
    // SSR + client first paint render the same data — no skeleton, no refetch
    // flash. Mirrors the marketplace browse pattern (useListings).
    ...(options?.initialData ? { initialData: options.initialData } : {}),
  });
}

export function useJob(id: string, options?: { initialData?: JobDetail }) {
  return useQuery({
    queryKey: ['jobs', id],
    queryFn: () => api.getPublic<{ job: JobDetail }>(`/api/v1/jobs/${id}`).then((res) => res.job),
    enabled: !!id,
    // Optional server-seeded detail (the RSC page passes its fetch result) so
    // SSR + client first paint render the same data — no skeleton, no refetch
    // flash. Mirrors useListing / the marketplace detail pattern.
    ...(options?.initialData ? { initialData: options.initialData } : {}),
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateJobInput) => postJob('/api/v1/jobs', input),
    onSuccess: () => {
      toast.success('Job created');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: explainFailure('Failed to create job'),
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateJobInput }) =>
      patchJob(`/api/v1/jobs/${id}`, input),
    onSuccess: () => {
      toast.success('Job updated');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: explainFailure('Failed to update job'),
  });
}

export function usePublishJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postJob(`/api/v1/jobs/${id}/publish`),
    onSuccess: () => {
      toast.success('Job published — providers can now bid');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: explainFailure('Failed to publish job'),
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<Record<string, never>>(`/api/v1/jobs/${id}`),
    onSuccess: () => {
      toast.success('Draft deleted');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: explainFailure('Failed to delete draft'),
  });
}

export function useCloseAuction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postJob(`/api/v1/jobs/${id}/close`),
    onSuccess: () => {
      toast.success('Auction closed');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: explainFailure('Failed to close auction'),
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postJob(`/api/v1/jobs/${id}/cancel`),
    onSuccess: () => {
      toast.success('Job cancelled');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: explainFailure('Failed to cancel job'),
  });
}

export interface CustomerJobsParams {
  status?: string;
  page?: number;
  page_size?: number;
  /** FR-19 — filter to one owned property. */
  property_id?: string;
  /** FR-19.3 history filter — category UUID. */
  category_id?: string;
  /** FR-19.3 history filter — RFC3339 or YYYY-MM-DD. */
  date_from?: string;
  /** FR-19.3 history filter — RFC3339 or YYYY-MM-DD (inclusive end-of-day for date-only). */
  date_to?: string;
  /** When false, the query is disabled (e.g. filtered history only when filters active). */
  enabled?: boolean;
}

export function useCustomerJobs(params?: CustomerJobsParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.property_id) searchParams.set('property_id', params.property_id);
  if (params?.category_id) searchParams.set('category_id', params.category_id);
  if (params?.date_from) searchParams.set('date_from', params.date_from);
  if (params?.date_to) searchParams.set('date_to', params.date_to);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/jobs/mine${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['jobs', 'mine', params],
    queryFn: () => api.get<JobsResponse>(path),
    enabled: params?.enabled !== false,
  });
}

export function useCustomerDrafts(params?: { page?: number; page_size?: number }) {
  const searchParams = new URLSearchParams();
  searchParams.set('status', 'draft');
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/jobs/mine?${query}`;

  return useQuery({
    queryKey: ['jobs', 'drafts', params],
    queryFn: () => api.get<JobsResponse>(path),
  });
}
