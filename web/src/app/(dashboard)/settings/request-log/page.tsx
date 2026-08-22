'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  clearClientActions,
  listClientActions,
  subscribeClientActions,
} from '@/lib/client-action-log';

function useClientActionLog() {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return subscribeClientActions(onStoreChange);
  }, []);
  const getSnapshot = useCallback(() => listClientActions(), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export default function RequestLogPage() {
  const events = useClientActionLog();

  return (
    <Card className="border-[rgba(201,168,76,0.12)] bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-xl text-white">Request log</CardTitle>
          <p className="mt-1 text-sm text-white/65">
            This browser only — last {events.length} API hops. Bodies, tokens, and query strings
            are never stored. Quote the request id when matching gateway logs.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          disabled={events.length === 0}
          onClick={() => {
            clearClientActions();
          }}
        >
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-white/60">
            No requests yet. Load another settings page or save a form — each API call appears
            here with status, duration, and request id.
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Recent API requests">
            {events.map((event) => (
              <li
                key={event.id}
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
                  · {event.durationMs} ms · {event.outcome}
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
