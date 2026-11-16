// Branch tests for the request-log settings page beyond
// settings-request-log.test.tsx: how local hops and server activity are merged
// (back-filling, ordering, id-less rows), the outcome label derived per HTTP
// status for server-only rows, the server note per state, and the Clear button.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeActivityItem } from '@/lib/api';
import {
  __resetClientActionsForTests,
  listClientActions,
  recordClientAction,
} from '@/lib/client-action-log';

import { withQueryClient } from './_helpers';

const fetchMeActivity = vi.fn<() => Promise<MeActivityItem[]>>();
let isAuthenticated = true;

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, fetchMeActivity: () => fetchMeActivity() };
});

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated }),
}));

const { default: RequestLogPage } = await import('@/app/(dashboard)/settings/request-log/page');

function serverRow(overrides: Partial<MeActivityItem> = {}): MeActivityItem {
  return {
    requestId: 'srv-1',
    method: 'GET',
    path: '/api/v1/jobs',
    status: 200,
    durationMs: 7,
    at: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Record a local hop stamped at a fixed instant. */
function recordAt(iso: string, input: Parameters<typeof recordClientAction>[0]) {
  vi.setSystemTime(new Date(iso));
  return recordClientAction(input);
}

function renderPage() {
  return render(withQueryClient(createElement(RequestLogPage)));
}

async function rows(expected: number): Promise<HTMLElement[]> {
  await waitFor(() => {
    expect(screen.getAllByRole('listitem')).toHaveLength(expected);
  });
  return screen.getAllByRole('listitem');
}

function note(text: string | RegExp) {
  return waitFor(() => {
    expect(screen.getByText(text)).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
  __resetClientActionsForTests();
  fetchMeActivity.mockReset();
  fetchMeActivity.mockResolvedValue([]);
  isAuthenticated = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestLogPage — server-only rows', () => {
  it.each([
    [0, 'no response', 'unreachable'],
    [204, '204', 'ok'],
    [401, '401', 'unauthorized'],
    [403, '403', 'forbidden'],
    [404, '404', 'not_found'],
    [409, '409', 'conflict'],
    [429, '429', 'rate_limited'],
    [500, '500', 'error'],
    [302, '302', 'error'],
  ])('labels a status %i row "%s · … · %s"', async (status, shown, outcome) => {
    fetchMeActivity.mockResolvedValue([serverRow({ status, durationMs: 42 })]);
    renderPage();
    const [row] = await rows(1);
    expect(row).toHaveTextContent(`http GET /api/v1/jobs`);
    expect(row).toHaveTextContent(`${shown} · 42 ms · ${outcome} · Server`);
    expect(row).toHaveTextContent('srv-1');
  });

  it('shows "no request id" for a server row that carries none', async () => {
    fetchMeActivity.mockResolvedValue([
      serverRow({ requestId: '', path: '/api/v1/a' }),
      serverRow({ requestId: '', path: '/api/v1/b', at: '2026-03-01T09:00:00.000Z' }),
    ]);
    renderPage();
    const [first, second] = await rows(2);
    expect(first).toHaveTextContent('/api/v1/a');
    expect(first).toHaveTextContent('no request id');
    expect(second).toHaveTextContent('/api/v1/b');
  });
});

describe('RequestLogPage — merging local hops with server activity', () => {
  it('back-fills status and duration the browser never saw from the matching server row', async () => {
    recordAt('2026-03-01T11:00:00.000Z', {
      method: 'post',
      path: '/api/v1/payments?token=secret',
      status: 0,
      durationMs: 0,
      requestId: 'req-timeout',
    });
    fetchMeActivity.mockResolvedValue([
      serverRow({ requestId: 'req-timeout', method: 'PUT', path: '/server/path', status: 503, durationMs: 950 }),
    ]);
    renderPage();
    await note('1 server row merged by request id.');

    const [row] = await rows(1);
    // Local method/path win (query string stripped); status + duration come from the server.
    expect(row).toHaveTextContent('http POST /api/v1/payments');
    expect(row).not.toHaveTextContent('secret');
    expect(row).not.toHaveTextContent('/server/path');
    expect(row).toHaveTextContent('503 · 950 ms · unreachable · Local + server');
  });

  it('keeps the locally observed status and duration when the browser did get a response', async () => {
    recordAt('2026-03-01T11:00:00.000Z', {
      method: 'GET',
      path: '/api/v1/users/me',
      status: 200,
      durationMs: 31,
      requestId: 'req-ok',
    });
    fetchMeActivity.mockResolvedValue([serverRow({ requestId: 'req-ok', status: 500, durationMs: 4 })]);
    renderPage();
    await note('1 server row merged by request id.');
    const [row] = await rows(1);
    expect(row).toHaveTextContent('200 · 31 ms · ok · Local + server');
  });

  it('leaves an unreachable local hop untouched when the server row has no status or timing either', async () => {
    recordAt('2026-03-01T11:00:00.000Z', {
      method: 'GET',
      path: '/api/v1/users/me',
      status: 0,
      durationMs: 0,
      requestId: 'req-dead',
    });
    fetchMeActivity.mockResolvedValue([serverRow({ requestId: 'req-dead', status: 0, durationMs: 0 })]);
    renderPage();
    await note('1 server row merged by request id.');
    const [row] = await rows(1);
    expect(row).toHaveTextContent('no response · 0 ms · unreachable · Local + server');
  });

  it('fills an empty local method and label from the server row', async () => {
    recordAt('2026-03-01T11:00:00.000Z', {
      kind: 'ui',
      method: '',
      path: '   ',
      status: 0,
      durationMs: 0,
      requestId: 'req-ui',
    });
    fetchMeActivity.mockResolvedValue([
      serverRow({ requestId: 'req-ui', method: 'DELETE', path: '/api/v1/jobs/9', status: 204, durationMs: 12 }),
    ]);
    renderPage();
    await note('1 server row merged by request id.');
    const [row] = await rows(1);
    expect(row).toHaveTextContent('ui DELETE /api/v1/jobs/9');
    // Non-HTTP kinds show the kind where the status code would be.
    expect(row).toHaveTextContent('ui · 12 ms · ui · Local + server');
    expect(row).not.toHaveTextContent('204');
  });

  it('lists a local hop without a request id separately, newest first across both sources', async () => {
    recordAt('2026-03-01T08:00:00.000Z', {
      kind: 'screen',
      method: 'VIEW',
      path: 'Settings',
      status: 0,
      durationMs: 0,
      requestId: '',
    });
    recordAt('2026-03-01T11:00:00.000Z', {
      method: 'GET',
      path: '/api/v1/newest',
      status: 200,
      durationMs: 5,
      requestId: 'req-new',
    });
    fetchMeActivity.mockResolvedValue([
      serverRow({ requestId: 'srv-mid', path: '/api/v1/middle', at: '2026-03-01T10:00:00.000Z' }),
      // Same instant as the screen view: order between the two is stable, both render.
      serverRow({ requestId: 'srv-tie', path: '/api/v1/tie', at: '2026-03-01T08:00:00.000Z' }),
    ]);
    renderPage();
    await note('2 server rows merged by request id.');

    const list = await rows(4);
    expect(list[0]).toHaveTextContent('/api/v1/newest');
    expect(list[0]).toHaveTextContent('This browser');
    expect(list[1]).toHaveTextContent('/api/v1/middle');
    expect(list[1]).toHaveTextContent('· Server');
    const tail = list.slice(2).map((li) => li.textContent);
    expect(tail.some((text) => text.includes('screen VIEW Settings'))).toBe(true);
    expect(tail.some((text) => text.includes('/api/v1/tie'))).toBe(true);
    const screenRow = list.slice(2).find((li) => li.textContent.includes('screen VIEW Settings'));
    if (!screenRow) throw new Error('screen row not rendered');
    expect(screenRow).toHaveTextContent('screen · 0 ms · screen · This browser');
    expect(screenRow).toHaveTextContent('no request id');
  });
});

describe('RequestLogPage — server note', () => {
  it('says the endpoint may be missing when the server returns nothing', async () => {
    renderPage();
    await note('No server activity (endpoint may be 404). Local hops still appear.');
  });

  it('surfaces the server error message', async () => {
    fetchMeActivity.mockRejectedValue(new Error('Gateway timed out'));
    renderPage();
    await note('Gateway timed out');
  });

  it('falls back to the local-only notice when the failure has no message', async () => {
    fetchMeActivity.mockRejectedValue(new Error(''));
    renderPage();
    await note('Server activity unavailable — showing this browser only.');
  });

  it('asks a signed-out visitor to sign in and still lists local hops', async () => {
    isAuthenticated = false;
    recordClientAction({ method: 'GET', path: '/api/v1/flags', status: 200, durationMs: 2, requestId: 'anon-1' });
    renderPage();
    await note('Sign in to merge server activity.');
    const [row] = await rows(1);
    expect(row).toHaveTextContent('anon-1');
    expect(fetchMeActivity).not.toHaveBeenCalled();
  });
});

describe('RequestLogPage — Clear', () => {
  it('is disabled with nothing local to clear, even when server rows are listed', async () => {
    fetchMeActivity.mockResolvedValue([serverRow()]);
    renderPage();
    await rows(1);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('empties the local action log when clicked', async () => {
    recordClientAction({ method: 'GET', path: '/api/v1/local', status: 200, durationMs: 2, requestId: 'local-1' });
    fetchMeActivity.mockResolvedValue([serverRow({ requestId: 'srv-keep', path: '/api/v1/server' })]);
    renderPage();
    await rows(2);

    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(listClientActions()).toHaveLength(0);
  });

  // The snapshot identity these two rely on is tested in client-action-log.snapshot.test.tsx.
  it('re-renders without the local rows after Clear', async () => {
    recordClientAction({ method: 'GET', path: '/api/v1/local', status: 200, durationMs: 2, requestId: 'local-1' });
    fetchMeActivity.mockResolvedValue([serverRow({ requestId: 'srv-keep', path: '/api/v1/server' })]);
    renderPage();
    await rows(2);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    const [row] = await rows(1);
    expect(row).toHaveTextContent('srv-keep');
    expect(screen.queryByText(/local-1/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('lists a hop recorded after mount', async () => {
    renderPage();
    await note('No server activity (endpoint may be 404). Local hops still appear.');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    act(() => {
      recordClientAction({ method: 'GET', path: '/api/v1/late', status: 200, durationMs: 2, requestId: 'late-1' });
    });

    const [row] = await rows(1);
    expect(row).toHaveTextContent('/api/v1/late');
    expect(row).toHaveTextContent('late-1');
  });
});
