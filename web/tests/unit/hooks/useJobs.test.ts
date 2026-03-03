import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useSearchJobs,
  useJob,
  useCreateJob,
  useUpdateJob,
  usePublishJob,
  useDeleteDraft,
  useCloseAuction,
  useCancelJob,
  useCustomerJobs,
  useCustomerDrafts,
} from '@/hooks/useJobs';
import type { Job, JobDetail, JobsResponse } from '@/types';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const { api } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockJob: Job = {
  id: 'job-1',
  customer_id: 'cust-1',
  category_id: 'cat-1',
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  title: 'Fix kitchen sink',
  description: 'A'.repeat(50),
  status: 'active',
  schedule_type: 'flexible',
  scheduled_date: null,
  is_recurring: false,
  recurrence_frequency: null,
  location_address: '123 Main St',
  location_lat: 40.7128,
  location_lng: -74.006,
  starting_bid_cents: 10000,
  offer_accepted_cents: null,
  auction_duration_hours: 48,
  auction_ends_at: '2026-03-05T12:00:00Z',
  bid_count: 3,
  lowest_bid_cents: 8000,
  market_range: null,
  created_at: '2026-03-01T12:00:00Z',
  updated_at: '2026-03-01T12:00:00Z',
};

const mockJobDetail: JobDetail = {
  ...mockJob,
  customer_display_name: 'Test Customer',
  customer_avatar_url: null,
  customer_member_since: '2025-01-01T00:00:00Z',
  customer_jobs_posted: 5,
};

const mockJobsResponse: JobsResponse = {
  jobs: [mockJob],
  pagination: {
    totalCount: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    hasNext: false,
  },
};

describe('useSearchJobs', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches jobs with search params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockJobsResponse);

    const { result } = renderHook(
      () => useSearchJobs({ category_id: 'cat-1', page: 1 }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.jobs).toHaveLength(1);
    expect(result.current.data?.jobs[0]?.id).toBe('job-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/jobs?category_id=cat-1&page=1',
    );
  });

  it('handles empty search params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockJobsResponse);

    const { result } = renderHook(() => useSearchJobs({}), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/jobs');
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useSearchJobs({}), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
  });

  it('starts in loading state', () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useSearchJobs({}), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});

describe('useJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches a single job by id', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ job: mockJobDetail });

    const { result } = renderHook(() => useJob('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe('job-1');
    expect(result.current.data?.customer_display_name).toBe('Test Customer');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useJob(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useJob('bad-id'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreateJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('creates a job and invalidates queries', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ job: mockJob });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateJob(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      category_id: 'cat-1',
      title: 'Fix kitchen sink plumbing issue',
      description: 'A'.repeat(50),
      schedule_type: 'flexible',
      is_recurring: false,
      auction_duration_hours: 48,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe('job-1');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['jobs'],
    });
  });

  it('handles creation error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Validation failed'));

    const { result } = renderHook(() => useCreateJob(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      category_id: 'cat-1',
      title: 'Fix kitchen sink plumbing issue',
      description: 'A'.repeat(50),
      schedule_type: 'flexible',
      is_recurring: false,
      auction_duration_hours: 48,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('updates a job', async () => {
    const updatedJob = { ...mockJob, title: 'Updated title for the job' };
    vi.mocked(api.patch).mockResolvedValueOnce({ job: updatedJob });

    const { result } = renderHook(() => useUpdateJob(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      id: 'job-1',
      input: { title: 'Updated title for the job' },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.title).toBe('Updated title for the job');
  });
});

describe('usePublishJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('publishes a draft job', async () => {
    const publishedJob = { ...mockJob, status: 'active' as const };
    vi.mocked(api.post).mockResolvedValueOnce({ job: publishedJob });

    const { result } = renderHook(() => usePublishJob(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('job-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe('active');
  });
});

describe('useDeleteDraft', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('deletes a draft job', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({});

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteDraft(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('job-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['jobs'],
    });
  });
});

describe('useCloseAuction', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('closes an auction', async () => {
    const closedJob = { ...mockJob, status: 'closed' as const };
    vi.mocked(api.post).mockResolvedValueOnce({ job: closedJob });

    const { result } = renderHook(() => useCloseAuction(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('job-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe('closed');
  });
});

describe('useCancelJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('cancels a job', async () => {
    const cancelledJob = { ...mockJob, status: 'cancelled' as const };
    vi.mocked(api.post).mockResolvedValueOnce({ job: cancelledJob });

    const { result } = renderHook(() => useCancelJob(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('job-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe('cancelled');
  });
});

describe('useCustomerJobs', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches customer jobs', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockJobsResponse);

    const { result } = renderHook(
      () => useCustomerJobs({ status: 'active', page: 1 }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.jobs).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/jobs/mine?status=active&page=1',
    );
  });

  it('fetches without params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockJobsResponse);

    const { result } = renderHook(() => useCustomerJobs(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/jobs/mine');
  });
});

describe('useCustomerDrafts', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches customer drafts', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockJobsResponse);

    const { result } = renderHook(() => useCustomerDrafts({ page: 1 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/jobs/mine?status=draft&page=1',
    );
  });

  it('always includes status=draft in params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockJobsResponse);

    const { result } = renderHook(() => useCustomerDrafts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/jobs/mine?status=draft',
    );
  });
});
