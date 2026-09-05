import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetClientActionsForTests,
  recordClientAction,
} from '@/lib/client-action-log';

import { withQueryClient } from './_helpers';

const fetchMeActivity = vi.fn();
let isAuthenticated = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/request-log',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    fetchMeActivity: (...args: unknown[]) => fetchMeActivity(...args),
  };
});

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated }),
}));

const { default: RequestLogPage } = await import(
  '@/app/(dashboard)/settings/request-log/page'
);

describe('RequestLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetClientActionsForTests();
    isAuthenticated = true;
    fetchMeActivity.mockResolvedValue([]);
  });

  it('renders local hops when the server activity endpoint 404s', async () => {
    fetchMeActivity.mockResolvedValue([]);
    recordClientAction({
      method: 'GET',
      path: '/api/v1/users/me',
      status: 200,
      durationMs: 11,
      requestId: 'local-req-1',
    });
    render(withQueryClient(createElement(RequestLogPage)));
    expect(screen.getByRole('heading', { name: /Request log/i })).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/\/api\/v1\/users\/me/)).toBeDefined();
    });
    expect(screen.getByText('local-req-1')).toBeDefined();
    expect(screen.getAllByText(/This browser/).length).toBeGreaterThan(0);
  });

  it('merges server rows with local hops on request id', async () => {
    fetchMeActivity.mockResolvedValue([
      {
        requestId: 'shared-id',
        method: 'GET',
        path: '/api/v1/users/me',
        status: 200,
        durationMs: 8,
        at: '2026-01-01T00:00:01Z',
      },
    ]);
    recordClientAction({
      method: 'GET',
      path: '/api/v1/users/me',
      status: 200,
      durationMs: 11,
      requestId: 'shared-id',
    });
    render(withQueryClient(createElement(RequestLogPage)));
    await waitFor(() => {
      expect(screen.getByText(/Local \+ server/)).toBeDefined();
    });
    expect(fetchMeActivity).toHaveBeenCalled();
  });

  it('skips the server fetch when signed out', async () => {
    isAuthenticated = false;
    render(withQueryClient(createElement(RequestLogPage)));
    await waitFor(() => {
      expect(screen.getByText(/Sign in to merge server activity/i)).toBeDefined();
    });
    expect(fetchMeActivity).not.toHaveBeenCalled();
  });

  it('shows empty copy when there are no hops', async () => {
    render(withQueryClient(createElement(RequestLogPage)));
    await waitFor(() => {
      expect(screen.getByText(/No requests yet/i)).toBeDefined();
    });
  });

  it('renders server-only rows when the request id is new', async () => {
    fetchMeActivity.mockResolvedValue([
      {
        requestId: 'server-only',
        method: 'POST',
        path: '/api/v1/jobs',
        status: 201,
        durationMs: 4,
        at: '2026-06-01T00:00:00Z',
      },
    ]);
    render(withQueryClient(createElement(RequestLogPage)));
    await waitFor(() => {
      expect(screen.getByText('server-only')).toBeDefined();
    });
    expect(screen.getByText(/Server$/)).toBeDefined();
  });

  it('keeps local hops when the server query fails', async () => {
    fetchMeActivity.mockRejectedValue(new Error('gateway down'));
    recordClientAction({
      method: 'GET',
      path: '/api/v1/contracts',
      status: 0,
      durationMs: 3,
      requestId: 'down-1',
    });
    render(withQueryClient(createElement(RequestLogPage)));
    await waitFor(() => {
      expect(screen.getByText(/Server activity unavailable|gateway down/i)).toBeDefined();
    });
    expect(screen.getByText('down-1')).toBeDefined();
    expect(screen.getByText(/no response/i)).toBeDefined();
  });
});
