/**
 * report-web-vitals — lightweight Core Web Vitals reporter.
 *
 * No hard dependency on the `web-vitals` package: uses PerformanceObserver
 * (and Navigation Timing for TTFB) so it works with zero extra installs.
 * Failures are swallowed — reporting must never break the app.
 *
 * Sinks:
 *   - development: `console.info` with a `[web-vitals]` prefix
 *   - production: POST /api/v1/rum (no cookies / no PII) + Sentry metrics
 *
 * Call once from a client provider (see WebVitalsReporter).
 */
import { metrics } from '@sentry/nextjs';

export type WebVitalName = 'CLS' | 'LCP' | 'INP' | 'FCP' | 'TTFB';

export interface WebVitalMetric {
  name: WebVitalName;
  value: number;
  /** unit for display / metrics (ms except CLS which is unitless) */
  unit: 'ms' | 'score';
  rating: 'good' | 'needs-improvement' | 'poor';
}

type MetricSink = (metric: WebVitalMetric) => void;

function rate(name: WebVitalName, value: number): WebVitalMetric['rating'] {
  // Thresholds from web.dev / Chrome UX Report (approx. good / poor).
  switch (name) {
    case 'CLS':
      if (value <= 0.1) return 'good';
      if (value <= 0.25) return 'needs-improvement';
      return 'poor';
    case 'LCP':
      if (value <= 2500) return 'good';
      if (value <= 4000) return 'needs-improvement';
      return 'poor';
    case 'INP':
      if (value <= 200) return 'good';
      if (value <= 500) return 'needs-improvement';
      return 'poor';
    case 'FCP':
      if (value <= 1800) return 'good';
      if (value <= 3000) return 'needs-improvement';
      return 'poor';
    case 'TTFB':
      if (value <= 800) return 'good';
      if (value <= 1800) return 'needs-improvement';
      return 'poor';
    default:
      return 'needs-improvement';
  }
}

function emit(sink: MetricSink, name: WebVitalName, value: number, unit: WebVitalMetric['unit']) {
  sink({ name, value, unit, rating: rate(name, value) });
}

function sendToSentry(metric: WebVitalMetric): void {
  // Static named import rather than `import('@sentry/nextjs')`.
  //
  // A namespace dynamic import of a barrel cannot be tree-shaken, so it was
  // emitting a SECOND copy of the entire browser SDK — a lazily loaded ~202 KB
  // chunk including the rrweb replay recorder we do not even register. The
  // package is already in the client graph, statically imported by
  // `src/instrumentation-client.ts` to call Sentry.init, so importing the one
  // symbol we need deduplicates into that existing module instead of
  // duplicating it.
  //
  // Still no-op safe without the optional chaining: with no DSN configured,
  // Sentry.init leaves a no-op client in place and distribution() discards the
  // metric internally. The chaining was only meaningful while the module shape
  // was untyped, and the linter correctly flags it as dead once it is not.
  // `attributes`, not `tags`. The previous dynamic import cast the module to a
  // hand-written shape, which silenced the type error — so every web vital was
  // shipped with its rating SILENTLY DROPPED, leaving no way to tell a "good"
  // LCP from a "poor" one in Sentry. Typing the call surfaced it immediately.
  metrics.distribution(`web_vital.${metric.name.toLowerCase()}`, metric.value, {
    unit: metric.unit === 'ms' ? 'millisecond' : 'none',
    attributes: { rating: metric.rating },
  });
}

const rumPathMaxLen = 200;

/** Public ingest URL. Empty NEXT_PUBLIC_API_URL → same-origin `/api/v1/rum`. */
export function rumIngestURL(): string {
  const base = (process.env['NEXT_PUBLIC_API_URL'] ?? '').replace(/\/$/, '');
  return `${base}/api/v1/rum`;
}

/** Drop query/hash and cap at 200 chars. Empty → `/`. */
export function sanitizeRumPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '/';
  let path = trimmed;
  try {
    const u = new URL(trimmed, 'https://nomarkup.invalid');
    path = u.pathname || '/';
  } catch {
    const cut = trimmed.search(/[?#]/);
    path = cut >= 0 ? trimmed.slice(0, cut) : trimmed;
  }
  path = path.trim() || '/';
  return path.length > rumPathMaxLen ? path.slice(0, rumPathMaxLen) : path;
}

function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return sanitizeRumPath(window.location.pathname || '/');
}

/**
 * POST one anonymous sample. credentials:omit so cookies never travel.
 * Fail-soft: network errors are swallowed.
 */
export function postFieldRum(metric: WebVitalMetric): void {
  try {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      path: currentPath(),
    });
    void fetch(rumIngestURL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // fail-soft — reporting must never break the app
  }
}

const queuedRum = new Map<WebVitalName, WebVitalMetric>();
const rumTimerSent = new Set<WebVitalName>();
let rumHideBound = false;

function flushQueuedRum(): void {
  for (const metric of queuedRum.values()) {
    postFieldRum(metric);
  }
  queuedRum.clear();
}

function bindRumHideFlush(): void {
  if (rumHideBound || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  rumHideBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushQueuedRum();
  });
  window.addEventListener('pagehide', flushQueuedRum);
}

/** FCP/TTFB send once immediately; LCP/INP/CLS keep latest and flush on hide + 4s. */
export function queueFieldRum(metric: WebVitalMetric): void {
  bindRumHideFlush();
  if (metric.name === 'FCP' || metric.name === 'TTFB') {
    postFieldRum(metric);
    return;
  }
  queuedRum.set(metric.name, metric);
  if (rumTimerSent.has(metric.name)) return;
  rumTimerSent.add(metric.name);
  setTimeout(() => {
    const latest = queuedRum.get(metric.name);
    if (latest) {
      queuedRum.delete(metric.name);
      postFieldRum(latest);
    }
  }, 4000);
}

function defaultSink(metric: WebVitalMetric): void {
  if (process.env.NODE_ENV !== 'production') {
    // Dev-only structured log — intentional sink for local CWV inspection.
    // eslint-disable-next-line no-console -- web-vitals dev sink
    console.info(
      `[web-vitals] ${metric.name}=${metric.value.toFixed(metric.unit === 'score' ? 3 : 0)}${metric.unit === 'ms' ? 'ms' : ''} (${metric.rating})`,
    );
    return;
  }
  sendToSentry(metric);
  queueFieldRum(metric);
}

/**
 * Start observing Core Web Vitals. Returns an unsubscribe function.
 * Safe to call multiple times; each call attaches its own observers.
 */
export function reportWebVitals(sink: MetricSink = defaultSink): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => undefined;
  }

  const observers: PerformanceObserver[] = [];

  const observe = (type: string, cb: (list: PerformanceObserverEntryList) => void) => {
    try {
      const po = new PerformanceObserver(cb);
      po.observe({ type, buffered: true } as PerformanceObserverInit);
      observers.push(po);
    } catch {
      // Unsupported entry type in this browser — skip.
    }
  };

  // LCP
  observe('largest-contentful-paint', (list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (last) emit(sink, 'LCP', last.startTime, 'ms');
  });

  // FCP
  observe('paint', (list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') {
        emit(sink, 'FCP', entry.startTime, 'ms');
      }
    }
  });

  // CLS
  let clsValue = 0;
  observe('layout-shift', (list) => {
    for (const entry of list.getEntries()) {
      const ls = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
      if (!ls.hadRecentInput && typeof ls.value === 'number') {
        clsValue += ls.value;
        emit(sink, 'CLS', clsValue, 'score');
      }
    }
  });

  // INP (event timing — approximation of Interaction to Next Paint)
  let maxINP = 0;
  observe('event', (list) => {
    for (const entry of list.getEntries()) {
      const ev = entry as PerformanceEntry & { duration?: number; interactionId?: number };
      if (ev.interactionId && typeof ev.duration === 'number' && ev.duration > maxINP) {
        maxINP = ev.duration;
        emit(sink, 'INP', maxINP, 'ms');
      }
    }
  });

  // TTFB from Navigation Timing
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav) {
      emit(sink, 'TTFB', nav.responseStart, 'ms');
    }
  } catch {
    // no-op
  }

  return () => {
    for (const po of observers) {
      try {
        po.disconnect();
      } catch {
        // no-op
      }
    }
  };
}
