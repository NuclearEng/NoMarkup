import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';

import { QueryProvider } from '@/components/providers/QueryProvider';
import { ApiError } from '@/lib/api';

describe('QueryProvider', () => {
  it('renders its children', () => {
    render(
      <QueryProvider>
        <div data-testid="child">child content</div>
      </QueryProvider>,
    );
    expect(screen.getByTestId('child').textContent).toBe('child content');
  });

  it('does not retry queries that fail with an ApiError (status >= 400)', async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new ApiError(404, '{"error":"Job not found"}'));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryProvider>{children}</QueryProvider>
    );

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['test-api-error'],
          queryFn,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // ApiError with status >= 400 → retry returns false → exactly one call.
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('retries non-ApiError failures up to one time (failureCount < 1)', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('network glitch'));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryProvider>{children}</QueryProvider>
    );

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['test-network-error'],
          queryFn,
          retryDelay: 0,
        }),
      { wrapper },
    );

    await waitFor(
      () => {
        expect(result.current.isError).toBe(true);
      },
      { timeout: 5000 },
    );

    // Default retry policy: failureCount<1 retries → 1 retry → 2 calls total.
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('exposes a QueryClient via context (useQueryClient resolves)', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryProvider>{children}</QueryProvider>
    );

    const { result } = renderHook(() => useQueryClient(), { wrapper });
    // QueryClient instance has getDefaultOptions().
    expect(typeof result.current.getDefaultOptions).toBe('function');
    const opts = result.current.getDefaultOptions();
    expect(opts.queries?.staleTime).toBe(60 * 1000);
  });
});
