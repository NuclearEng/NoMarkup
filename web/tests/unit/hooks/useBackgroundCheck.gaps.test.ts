// useBackgroundCheck — remaining status labels, the invitation-URL fallbacks,
// the query's retry policy (no retry on 503 / 401, one retry otherwise), the
// `enabled` guard and the error-message helper.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  backgroundCheckErrorMessage,
  backgroundCheckInvitationURL,
  backgroundCheckQueryKey,
  canStartBackgroundCheck,
  formatBackgroundCheckStatus,
  normalizeBackgroundCheckStatus,
  useBackgroundCheck,
} from '@/hooks/useBackgroundCheck';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, post: vi.fn() } };
});

const { ApiError } = await import('@/lib/api');

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  mocks.get.mockReset();
  queryClient = new QueryClient({
    // The hook supplies its own `retry` function; only the delay is ours.
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
});

afterEach(() => {
  queryClient.clear();
});

describe('formatBackgroundCheckStatus', () => {
  it.each([
    ['suspended', 'Suspended'],
    ['canceled', 'Canceled'],
    ['cancelled', 'Canceled'],
    ['dispute', 'Dispute'],
    ['complete', 'Complete (awaiting result)'],
    ['none', 'Not started'],
    ['  CLEAR  ', 'Clear'],
    [undefined, 'Not started'],
    [null, 'Not started'],
  ])('%j → %s', (status, label) => {
    expect(formatBackgroundCheckStatus(status)).toBe(label);
  });

  it('shows an unknown vendor status in lower case with underscores as spaces', () => {
    expect(formatBackgroundCheckStatus('Needs_Manual_Review')).toBe('needs manual review');
  });
});

describe('normalizeBackgroundCheckStatus / canStartBackgroundCheck', () => {
  it('maps whitespace-only to not_started', () => {
    expect(normalizeBackgroundCheckStatus('   ')).toBe('not_started');
  });

  it.each([
    ['cancelled', true],
    ['SUSPENDED', true],
    ['none', true],
    [null, true],
    ['pending', false],
    ['clear', false],
    ['consider', false],
    ['dispute', false],
    ['complete', false],
    ['something_new', false],
  ])('canStart(%j) = %s', (status, expected) => {
    expect(canStartBackgroundCheck(status)).toBe(expected);
  });
});

describe('backgroundCheckInvitationURL', () => {
  it('falls back to report_url when there is no invitation_url', () => {
    expect(
      backgroundCheckInvitationURL({ status: 'pending', report_url: ' https://checkr.test/r/1 ' }),
    ).toBe('https://checkr.test/r/1');
  });

  it('prefers invitation_url over report_url', () => {
    expect(
      backgroundCheckInvitationURL({
        status: 'pending',
        invitation_url: 'http://checkr.test/i/1',
        report_url: 'https://checkr.test/r/1',
      }),
    ).toBe('http://checkr.test/i/1');
  });

  it.each([
    ['a null row', null],
    ['an undefined row', undefined],
    ['a row with neither URL', { status: 'pending' }],
    ['null URLs', { status: 'pending', invitation_url: null, report_url: null }],
    ['a javascript: URL', { status: 'pending', invitation_url: 'javascript:alert(1)' }],
    ['a protocol-relative URL', { status: 'pending', invitation_url: '//checkr.test/i/1' }],
  ])('returns null for %s', (_name, row) => {
    expect(backgroundCheckInvitationURL(row)).toBeNull();
  });

  it('does not fall through to report_url when invitation_url is an unusable non-null string', () => {
    expect(
      backgroundCheckInvitationURL({
        status: 'pending',
        invitation_url: 'ftp://checkr.test/i/1',
        report_url: 'https://checkr.test/r/1',
      }),
    ).toBeNull();
  });
});

describe('useBackgroundCheck — retry policy and enabled guard', () => {
  it.each([503, 401])('does not retry a %d', async (status) => {
    mocks.get.mockRejectedValue(new ApiError(status, '{"error":"nope"}'));

    const { result } = renderHook(() => useBackgroundCheck(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/providers/me/background-check');
  });

  it('retries any other ApiError exactly once before failing', async () => {
    mocks.get.mockRejectedValue(new ApiError(500, 'boom'));

    const { result } = renderHook(() => useBackgroundCheck(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('recovers when the single retry of a network error succeeds', async () => {
    mocks.get
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ status: 'pending' });

    const { result } = renderHook(() => useBackgroundCheck(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ status: 'pending' });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(backgroundCheckQueryKey)).toEqual({ status: 'pending' });
  });

  it('does not fetch when disabled', () => {
    const { result } = renderHook(() => useBackgroundCheck(false), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('backgroundCheckErrorMessage', () => {
  it('unwraps the gateway error string from an ApiError', () => {
    expect(
      backgroundCheckErrorMessage(new ApiError(503, '{"error":"Checkr is not configured"}'), 'fallback'),
    ).toBe('Checkr is not configured');
  });

  it('uses the message of a plain Error', () => {
    expect(backgroundCheckErrorMessage(new Error('offline'), 'fallback')).toBe('offline');
  });

  it('uses the fallback for a non-error value', () => {
    expect(backgroundCheckErrorMessage('nope', 'Could not start the check')).toBe(
      'Could not start the check',
    );
  });
});
