/**
 * report-web-vitals — lightweight Core Web Vitals reporter.
 *
 * No hard dependency on the `web-vitals` package: uses PerformanceObserver
 * (and Navigation Timing for TTFB) so it works with zero extra installs.
 * Failures are swallowed — reporting must never break the app.
 *
 * Sinks:
 *   - development: `console.info` with a `[web-vitals]` prefix
 *   - production: Sentry metrics via `@sentry/nextjs` when available (no-op safe)
 *
 * Call once from a client provider (see WebVitalsReporter).
 */

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
  // Dynamic import — no-op safe if Sentry is unavailable or metrics API changes.
  void import('@sentry/nextjs')
    .then((mod) => {
      const metrics = (
        mod as {
          metrics?: {
            distribution?: (name: string, value: number, opts?: Record<string, unknown>) => void;
          };
        }
      ).metrics;
      metrics?.distribution?.(`web_vital.${metric.name.toLowerCase()}`, metric.value, {
        unit: metric.unit === 'ms' ? 'millisecond' : 'none',
        tags: { rating: metric.rating },
      });
    })
    .catch(() => {
      // no-op
    });
}

function defaultSink(metric: WebVitalMetric): void {
  if (process.env.NODE_ENV !== 'production') {
    // Dev-only structured log — intentional sink for local CWV inspection.
    // eslint-disable-next-line no-console -- web-vitals dev sink
    console.info(
      `[web-vitals] ${metric.name}=${metric.value.toFixed(metric.unit === 'score' ? 3 : 0)}${metric.unit === 'ms' ? 'ms' : ''} (${metric.rating})`,
    );
  } else {
    sendToSentry(metric);
  }
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
