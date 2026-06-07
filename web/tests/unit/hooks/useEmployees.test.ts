import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAddEmployee,
  useEmployees,
  useRemoveEmployee,
  useUpdateEmployee,
} from '@/hooks/useEmployees';
import type { AddEmployeeInput, CompanyEmployee } from '@/types';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public body: string) {
      super(`API ${String(status)}: ${body}`);
      this.name = 'ApiError';
    }
  }
  return {
    api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    ApiError,
    getApiErrorMessage: (err: unknown, fallback: string): string =>
      err instanceof Error && err.message ? err.message : fallback,
  };
});

const { api, ApiError: FakeApiError } = await import('@/lib/api');

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const mockEmployee: CompanyEmployee = {
  id: 'emp-1',
  provider_id: 'prov-1',
  first_name: 'Sam',
  last_name: 'Rivera',
  email: 'sam@example.com',
  phone: null,
  date_of_birth: null,
  role: 'technician',
  status: 'active',
  hire_date: '2026-01-01',
  background_check_status: 'passed',
  background_check_date: '2026-01-05',
  license_number: null,
  license_state: null,
  license_expiry: null,
  insurance_policy_number: null,
  insurance_expiry: null,
  created_at: '2026-01-01T00:00:00Z',
};

const addEmployeeInput: AddEmployeeInput = {
  first_name: 'Sam',
  last_name: 'Rivera',
  email: 'sam@example.com',
  role: 'technician',
};

describe('useEmployees', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches employee list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ employees: [mockEmployee] });
    const { result } = renderHook(() => useEmployees(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.employees).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/employees');
  });

  it('returns null on 404 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'none'));
    const { result } = renderHook(() => useEmployees(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'down'));
    const { result } = renderHook(() => useEmployees(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404/500 errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(401, 'no auth'));
    const { result } = renderHook(() => useEmployees(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});

describe('useAddEmployee', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts employee, unwraps { employee }, and invalidates employees cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ employee: mockEmployee });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useAddEmployee(), { wrapper: wrap(client) });
    result.current.mutate(addEmployeeInput);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/providers/me/employees',
      addEmployeeInput,
    );
    expect(result.current.data?.id).toBe('emp-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['employees'] });
  });

  it('shows toast.error on add failure (covers onError)', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAddEmployee(), { wrapper: wrap(client) });
    result.current.mutate(addEmployeeInput);
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    // getApiErrorMessage surfaces the Error/server reason; literal remains the fallback.
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('boom');
  });
});

describe('useUpdateEmployee', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('patches employee, unwraps { employee }, and invalidates employees cache', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({
      employee: { ...mockEmployee, status: 'suspended' },
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper: wrap(client) });
    result.current.mutate({ id: 'emp-1', data: { status: 'suspended' } });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      '/api/v1/providers/me/employees/emp-1',
      { status: 'suspended' },
    );
    expect(result.current.data?.status).toBe('suspended');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['employees'] });
  });

  it('shows toast.error on update failure (covers onError)', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper: wrap(client) });
    result.current.mutate({ id: 'emp-1', data: { status: 'suspended' } });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('boom');
  });
});

describe('useRemoveEmployee', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('deletes by id and invalidates employees cache', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRemoveEmployee(), { wrapper: wrap(client) });
    result.current.mutate('emp-1');
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/providers/me/employees/emp-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['employees'] });
  });

  it('shows toast.error on remove failure (covers onError)', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useRemoveEmployee(), { wrapper: wrap(client) });
    result.current.mutate('emp-1');
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('boom');
  });
});
