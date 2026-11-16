// client-action-log — the parts client-action-log.test.ts leaves out: the
// status -> outcome table, UI-label redaction, field normalisation, the
// subscribe/clear notifications, the id fallback when crypto.randomUUID is
// missing, and the window debug hook (absent on the server).
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetClientActionsForTests,
  clearClientActions,
  listClientActions,
  recordClientAction,
  sanitizeUiLabel,
  sanitizedApiPath,
  subscribeClientActions,
  type ClientActionEvent,
  type ClientActionKind,
} from '@/lib/client-action-log';

type DebugWindow = Window & { __NOMARKUP_ACTION_LOG__?: () => readonly ClientActionEvent[] };

function record(overrides: Partial<Parameters<typeof recordClientAction>[0]> = {}) {
  return recordClientAction({
    method: 'GET',
    path: '/api/v1/x',
    status: 200,
    durationMs: 1,
    requestId: 'req-1',
    ...overrides,
  });
}

describe('client-action-log outcomes and sanitising', () => {
  afterEach(() => {
    __resetClientActionsForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window as DebugWindow, '__NOMARKUP_ACTION_LOG__');
  });

  it.each<[number, string]>([
    [0, 'unreachable'],
    [200, 'ok'],
    [204, 'ok'],
    [299, 'ok'],
    [199, 'error'],
    [300, 'error'],
    [400, 'error'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [429, 'rate_limited'],
    [500, 'error'],
  ])('maps HTTP status %d to outcome %s', (status, outcome) => {
    expect(record({ status }).outcome).toBe(outcome);
  });

  it.each<[ClientActionKind, string]>([
    ['ui', 'ui'],
    ['screen', 'screen'],
  ])('a %s event keeps its own outcome whatever the status', (kind, outcome) => {
    expect(record({ kind, status: 0, path: 'Checkout' }).outcome).toBe(outcome);
    expect(record({ kind, status: 500, path: 'Checkout' }).outcome).toBe(outcome);
  });

  it('sanitises by kind: http paths lose their query, UI labels are redacted instead', () => {
    const http = record({ path: ' /api/v1/orders?token=abc#top ' });
    expect(http.path).toBe('/api/v1/orders');

    // A UI label is free text: `?` is kept, long digit runs are masked.
    const ui = record({ kind: 'ui', path: 'Pay   order 123456789?\n now' });
    expect(ui.path).toBe('Pay order [digits]? now');
  });

  it('normalises method, duration and request id', () => {
    const event = record({ method: 'patch', durationMs: -3.7, requestId: 'r'.repeat(80) });

    expect(event.method).toBe('PATCH');
    expect(event.durationMs).toBe(0);
    expect(event.requestId).toBe('r'.repeat(64));
    expect(record({ durationMs: 12.5 }).durationMs).toBe(13);
    expect(new Date(event.at).toISOString()).toBe(event.at);
  });

  describe('sanitizeUiLabel', () => {
    it.each<[string, string]>([
      ['  Sign   in\t\nnow ', 'Sign in now'],
      ['Card 4242424242424242', 'Card [digits]'],
      ['Order 12345', 'Order 12345'],
      ['Code 123456 and 9876543', 'Code [digits] and [digits]'],
    ])('%j -> %j', (raw, expected) => {
      expect(sanitizeUiLabel(raw)).toBe(expected);
    });

    it('keeps an 80-character label whole and truncates an 81-character one', () => {
      expect(sanitizeUiLabel('a'.repeat(80))).toBe('a'.repeat(80));
      expect(sanitizeUiLabel('a'.repeat(81))).toBe('a'.repeat(80));
    });
  });

  describe('sanitizedApiPath', () => {
    it.each<[string, string]>([
      ['/api/v1/me#section', '/api/v1/me'],
      ['/api/v1/me?x=1', '/api/v1/me'],
      ['  /api/v1/me  ', '/api/v1/me'],
      ['?only=query', '/'],
      ['#only-hash', '/'],
      ['', '/'],
    ])('%j -> %j', (raw, expected) => {
      expect(sanitizedApiPath(raw)).toBe(expected);
    });
  });

  describe('event ids', () => {
    it('uses crypto.randomUUID when available', () => {
      vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' });
      expect(record().id).toBe('uuid-1');
    });

    it.each<[string, unknown]>([
      ['crypto has no randomUUID', {}],
      ['crypto is undefined', undefined],
    ])('falls back to a timestamp + random id when %s', (_label, cryptoStub) => {
      vi.stubGlobal('crypto', cryptoStub);
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      expect(record().id).toBe(`1700000000000-${(0.5).toString(36).slice(2)}`);
    });
  });

  describe('subscriptions', () => {
    it('notifies every listener on record and on clear, and stops after unsubscribe', () => {
      const first = vi.fn();
      const second = vi.fn();
      const unsubscribeFirst = subscribeClientActions(first);
      subscribeClientActions(second);

      record();
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);

      unsubscribeFirst();
      clearClientActions();

      expect(listClientActions()).toHaveLength(0);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
    });

    it('the test reset drops listeners without notifying them', () => {
      const listener = vi.fn();
      subscribeClientActions(listener);
      record();

      __resetClientActionsForTests();
      record();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listClientActions()).toHaveLength(1);
    });
  });

  describe('window debug hook', () => {
    it('exposes the live log on window after the first record', () => {
      expect((window as DebugWindow).__NOMARKUP_ACTION_LOG__).toBeUndefined();

      const event = record({ path: '/api/v1/debug' });

      const hook = (window as DebugWindow).__NOMARKUP_ACTION_LOG__;
      expect(hook).toBe(listClientActions);
      expect(hook?.()[0]).toBe(event);
    });

    it('still records on the server, where there is no window to attach to', () => {
      const realWindow = window as DebugWindow;
      vi.stubGlobal('window', undefined);

      const event = record({ path: '/api/v1/ssr' });

      expect(listClientActions()[0]).toBe(event);
      expect(realWindow.__NOMARKUP_ACTION_LOG__).toBeUndefined();
    });
  });
});
