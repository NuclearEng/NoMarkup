/**
 * Device-local ring buffer of outbound API hops.
 *
 * Stitch a button/submit to gateway slog via `X-Request-ID`. Never stores
 * bodies, Authorization, or query strings.
 */

export type ClientActionKind = 'http' | 'ui' | 'screen';

export type ClientActionEvent = {
  id: string;
  at: string;
  kind: ClientActionKind;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  outcome: string;
};

export const CLIENT_ACTION_LOG_CAPACITY = 200;

const events: ClientActionEvent[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function outcomeFor(status: number, kind: ClientActionKind): string {
  if (kind === 'ui') return 'ui';
  if (kind === 'screen') return 'screen';
  if (status === 0) return 'unreachable';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'error';
}

export function sanitizeUiLabel(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const redacted = collapsed.replace(/\d{6,}/g, '[digits]');
  return redacted.length <= 80 ? redacted : redacted.slice(0, 80);
}

export function sanitizedApiPath(path: string): string {
  const trimmed = path.trim();
  const noHash = trimmed.split('#')[0] ?? trimmed;
  const noQuery = noHash.split('?')[0] ?? noHash;
  return noQuery.length > 0 ? noQuery : '/';
}

export function recordClientAction(input: {
  kind?: ClientActionKind;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
}): ClientActionEvent {
  const kind: ClientActionKind = input.kind ?? 'http';
  const path =
    kind === 'http' ? sanitizedApiPath(input.path) : sanitizeUiLabel(input.path);
  const event: ClientActionEvent = {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    kind,
    method: input.method.toUpperCase(),
    path,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    requestId: input.requestId.slice(0, 64),
    outcome: outcomeFor(input.status, kind),
  };
  events.unshift(event);
  if (events.length > CLIENT_ACTION_LOG_CAPACITY) {
    events.length = CLIENT_ACTION_LOG_CAPACITY;
  }
  emit();
  exposeLogOnWindow();
  return event;
}

function exposeLogOnWindow(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __NOMARKUP_ACTION_LOG__?: () => readonly ClientActionEvent[] };
  w.__NOMARKUP_ACTION_LOG__ = listClientActions;
}

export function listClientActions(): readonly ClientActionEvent[] {
  return events;
}

export function clearClientActions(): void {
  events.length = 0;
  emit();
}

export function subscribeClientActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper. */
export function __resetClientActionsForTests(): void {
  events.length = 0;
  listeners.clear();
}
