'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchMeActivity, getApiErrorMessage, type MeActivityItem } from '@/lib/api';
import {
  clearClientActions,
  listClientActions,
  subscribeClientActions,
  type ClientActionEvent,
} from '@/lib/client-action-log';
import { useAuthStore } from '@/stores/auth-store';

function useClientActionLog() {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return subscribeClientActions(onStoreChange);
  }, []);
  const getSnapshot = useCallback(() => listClientActions(), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

type MergedRow = {
  key: string;
  kind: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  outcome: string;
  source: 'local' | 'server' | 'both';
  at: string;
};

function outcomeForStatus(status: number): string {
  if (status === 0) return 'unreachable';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'error';
}

function mergeActivity(
  local: readonly ClientActionEvent[],
  server: readonly MeActivityItem[],
): MergedRow[] {
  const byId = new Map<string, MergedRow>();
  const unmatched: MergedRow[] = [];

  for (const event of local) {
    const row: MergedRow = {
      key: event.id,
      kind: event.kind,
      method: event.method,
      path: event.path,
      status: event.status,
      durationMs: event.durationMs,
      requestId: event.requestId,
      outcome: event.outcome,
      source: 'local',
      at: event.at,
    };
    if (event.requestId.length > 0) {
      byId.set(event.requestId, row);
    } else {
      unmatched.push(row);
    }
  }

  for (const item of server) {
    const existing = item.requestId.length > 0 ? byId.get(item.requestId) : undefined;
    if (existing) {
      existing.source = 'both';
      if (existing.status === 0 && item.status > 0) existing.status = item.status;
      if (existing.durationMs === 0 && item.durationMs > 0) existing.durationMs = item.durationMs;
      if (existing.path.length === 0) existing.path = item.path;
      if (existing.method.length === 0) existing.method = item.method;
      continue;
    }
    unmatched.push({
      key: `server-${item.requestId || item.at}-${item.path}`,
      kind: 'http',
      method: item.method,
      path: item.path,
      status: item.status,
      durationMs: item.durationMs,
      requestId: item.requestId,
      outcome: outcomeForStatus(item.status),
      source: 'server',
      at: item.at,
    });
  }

  return [...byId.values(), ...unmatched].sort((a, b) => {
    if (a.at === b.at) return 0;
    return a.at < b.at ? 1 : -1;
  });
}

function sourceLabel(source: MergedRow['source']): string {
  if (source === 'both') return 'Local + server';
  if (source === 'server') return 'Server';
  return 'This browser';
}

export default function RequestLogPage() {
  const localEvents = useClientActionLog();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const serverQuery = useQuery({
    queryKey: ['me-activity'],
    queryFn: fetchMeActivity,
    enabled: isAuthenticated,
    retry: false,
  });

  const serverRows = serverQuery.data ?? [];
  const rows = useMemo(
    () => mergeActivity(localEvents, serverRows),
    [localEvents, serverRows],
  );

  const serverNote = !isAuthenticated
    ? 'Sign in to merge server activity.'
    : serverQuery.isError
      ? getApiErrorMessage(serverQuery.error, 'Server activity unavailable — showing this browser only.')
      : serverRows.length === 0
        ? 'No server activity (endpoint may be 404). Local hops still appear.'
        : `${String(serverRows.length)} server row${serverRows.length === 1 ? '' : 's'} merged by request id.`;

  return (
    <Card className="border-[rgba(201,168,76,0.12)] bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-xl text-white">Request log</CardTitle>
          <p className="mt-1 text-sm text-white/65">
            This browser plus server activity when available. Bodies, tokens, and query strings
            are never stored. Quote the request id when matching gateway logs.
          </p>
          <p className="mt-1 text-xs text-white/50">{serverNote}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          disabled={localEvents.length === 0}
          onClick={() => {
            clearClientActions();
          }}
        >
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">
            No requests yet. Load another settings page or save a form — each API call appears
            here with status, duration, and request id.
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Recent API requests">
            {rows.map((event) => (
              <li
                key={event.key}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-3 font-mono text-xs"
              >
                <p className="text-sm text-white">
                  <span className="text-[var(--brand-gold)]">{event.kind}</span>{' '}
                  <span className="text-[var(--brand-gold)]">{event.method}</span> {event.path}
                </p>
                <p className="mt-1 text-white/70">
                  {event.kind === 'http'
                    ? event.status === 0
                      ? 'no response'
                      : String(event.status)
                    : event.kind}{' '}
                  · {event.durationMs} ms · {event.outcome} · {sourceLabel(event.source)}
                </p>
                <p className="mt-1 break-all text-white/50">
                  {event.requestId.length > 0 ? event.requestId : 'no request id'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
