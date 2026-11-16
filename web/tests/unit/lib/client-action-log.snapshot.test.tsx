// client-action-log — the list is a store snapshot for useSyncExternalStore,
// which compares snapshots by identity. The log used to mutate one array and
// return it every time, so a subscriber never re-rendered on a new entry or
// on Clear.
import { act, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CLIENT_ACTION_LOG_CAPACITY,
  __resetClientActionsForTests,
  clearClientActions,
  listClientActions,
  recordClientAction,
  subscribeClientActions,
} from '@/lib/client-action-log';

function record(path: string) {
  return recordClientAction({
    method: 'GET',
    path,
    status: 200,
    durationMs: 12,
    requestId: 'req-1',
  });
}

function LogCount() {
  const events = useSyncExternalStore(subscribeClientActions, listClientActions, listClientActions);
  return <p data-testid="count">{String(events.length)}</p>;
}

beforeEach(() => {
  __resetClientActionsForTests();
});

describe('client action log as a store snapshot', () => {
  it('returns a new array after a new entry and leaves the old one untouched', () => {
    const before = listClientActions();
    record('/api/v1/jobs');
    const after = listClientActions();

    expect(after).not.toBe(before);
    expect(before).toHaveLength(0);
    expect(after).toHaveLength(1);
  });

  it('returns the same array while nothing changes', () => {
    record('/api/v1/jobs');
    expect(listClientActions()).toBe(listClientActions());
  });

  it('returns a new empty array after Clear', () => {
    record('/api/v1/jobs');
    const before = listClientActions();
    clearClientActions();

    expect(listClientActions()).not.toBe(before);
    expect(listClientActions()).toHaveLength(0);
    expect(before).toHaveLength(1);
  });

  it('keeps newest first and caps the list', () => {
    for (let i = 0; i < CLIENT_ACTION_LOG_CAPACITY + 3; i += 1) {
      record(`/api/v1/jobs/${String(i)}`);
    }
    const events = listClientActions();
    expect(events).toHaveLength(CLIENT_ACTION_LOG_CAPACITY);
    expect(events[0]?.path).toContain(String(CLIENT_ACTION_LOG_CAPACITY + 2));
  });

  it('re-renders a subscribed component on a new entry and on Clear', () => {
    render(<LogCount />);
    expect(screen.getByTestId('count').textContent).toBe('0');

    act(() => {
      record('/api/v1/jobs');
    });
    expect(screen.getByTestId('count').textContent).toBe('1');

    act(() => {
      record('/api/v1/bids');
    });
    expect(screen.getByTestId('count').textContent).toBe('2');

    act(() => {
      clearClientActions();
    });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
