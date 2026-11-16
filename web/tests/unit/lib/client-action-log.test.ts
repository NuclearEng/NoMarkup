import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetClientActionsForTests,
  recordClientAction,
  listClientActions,
  sanitizedApiPath,
  CLIENT_ACTION_LOG_CAPACITY,
} from '@/lib/client-action-log';

describe('client-action-log', () => {
  afterEach(() => {
    __resetClientActionsForTests();
  });

  it('strips query strings so tokens never land in the log', () => {
    expect(sanitizedApiPath('/api/v1/users/me?access=secret#frag')).toBe('/api/v1/users/me');
  });

  it('records newest-first with status, duration, and request id', () => {
    recordClientAction({
      method: 'get',
      path: '/api/v1/users/me',
      status: 200,
      durationMs: 12.4,
      requestId: 'abc123abc123abcd',
    });
    recordClientAction({
      method: 'POST',
      path: '/api/v1/auth/login?x=1',
      status: 401,
      durationMs: 40,
      requestId: 'def456def456def0',
    });
    const rows = listClientActions();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.method).toBe('POST');
    expect(rows[0]?.path).toBe('/api/v1/auth/login');
    expect(rows[0]?.outcome).toBe('unauthorized');
    expect(rows[1]?.outcome).toBe('ok');
    expect(rows[1]?.durationMs).toBe(12);
    expect(rows[1]?.kind).toBe('http');
  });

  it('records UI taps without treating them as HTTP', () => {
    recordClientAction({
      kind: 'ui',
      method: 'TAP',
      path: 'Sign in',
      status: 1,
      durationMs: 0,
      requestId: '',
    });
    expect(listClientActions()[0]?.outcome).toBe('ui');
    expect(listClientActions()[0]?.kind).toBe('ui');
  });

  it('caps the ring buffer', () => {
    for (let i = 0; i < CLIENT_ACTION_LOG_CAPACITY + 5; i += 1) {
      recordClientAction({
        method: 'GET',
        path: `/api/v1/x/${String(i)}`,
        status: 200,
        durationMs: 1,
        requestId: 'aa',
      });
    }
    expect(listClientActions()).toHaveLength(CLIENT_ACTION_LOG_CAPACITY);
  });
});
