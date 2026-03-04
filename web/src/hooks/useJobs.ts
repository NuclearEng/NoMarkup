import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import type {
  CreateJobInput,
  Job,
  JobDetail,
  JobsResponse,
  SearchJobsParams,
  UpdateJobInput,
} from '@/types';

function buildSearchParams(params: SearchJobsParams): string {
  const searchParams = new URLSearchParams();
  if (params.category_id) searchParams.set('category_id', params.category_id);
  if (params.query) searchParams.set('query', params.query);
  if (params.schedule_type) searchParams.set('schedule_type', params.schedule_type);
  if (params.is_recurring !== undefined) searchParams.set('is_recurring', String(params.is_recurring));
  if (params.min_price_cents !== undefined) searchParams.set('min_price_cents', String(params.min_price_cents));
  if (params.max_price_cents !== undefined) searchParams.set('max_price_cents', String(params.max_price_cents));
  if (params.location_lat !== undefined) searchParams.set('location_lat', String(params.location_lat));
  if (params.location_lng !== undefined) searchParams.set('location_lng', String(params.location_lng));
  if (params.radius_km !== undefined) searchParams.set('radius_km', String(params.radius_km));
  if (params.status) searchParams.set('status', params.status);
  if (params.sort_by) searchParams.set('sort_by', params.sort_by);
  if (params.sort_order) searchParams.set('sort_order', params.sort_order);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export function useSearchJobs(params: SearchJobsParams) {
  return useQuery({
    queryKey: ['jobs', 'search', params],
    queryFn: () =>
      api.get<JobsResponse>(`/api/v1/jobs${buildSearchParams(params)}`),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ['jobs', id],
    queryFn: () =>
      api.get<{ job: JobDetail }>(`/api/v1/jobs/${id}`).then((res) => res.job),
    enabled: !!id,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateJobInput) =>
      api.post<{ job: Job }>('/api/v1/jobs', input).then((res) => res.job),
    onSuccess: () => {
      toast.success('Job created');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => {
      toast.error('Failed to create job');
    },
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateJobInput }) =>
      api.patch<{ job: Job }>(`/api/v1/jobs/${id}`, input).then((res) => res.job),
    onSuccess: () => {
      toast.success('Job updated');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => {
      toast.error('Failed to update job');
    },
  });
}

export function usePublishJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ job: Job }>(`/api/v1/jobs/${id}/publish`).then((res) => res.job),
    onSuccess: () => {
      toast.success('Job published — providers can now bid');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => {
      toast.error('Failed to publish job');
    },
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
    onError: () => {
      toast.error('Failed to delete draft');
    },
  });
}

export function useCloseAuction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ job: Job }>(`/api/v1/jobs/${id}/close`).then((res) => res.job),
    onSuccess: () => {
      toast.success('Auction closed');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => {
      toast.error('Failed to close auction');
    },
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ job: Job }>(`/api/v1/jobs/${id}/cancel`).then((res) => res.job),
    onSuccess: () => {
      toast.success('Job cancelled');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => {
      toast.error('Failed to cancel job');
    },
  });
}

export function useCustomerJobs(params?: { status?: string; page?: number; page_size?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/jobs/mine${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['jobs', 'mine', params],
    queryFn: () => api.get<JobsResponse>(path),
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
