// report-web-vitals — observer wiring, rating thresholds, the production sink
// (Sentry + RUM queue) and the dev sink. jsdom has no PerformanceObserver, so
// a controllable fake is installed; the module is re-imported per test because
// the RUM queue keeps module-level state (queued metrics, "timer sent" set,
// "hide listener bound" flag).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebVitalMetric } from '@/lib/report-web-vitals';

const distribution = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  metrics: { distribution: (...args: unknown[]): void => void distribution(...args) },
}));

type ObserverCallback = (list: PerformanceObserverEntryList) => void;

interface FakeEntry {
  name?: string;
  startTime?: number;
  duration?: number;
  value?: number;
  hadRecentInput?: boolean;
  interactionId?: number;
}

const registered = new Map<string, ObserverCallback>();
const disconnect = vi.fn();
let unsupportedTypes = new Set<string>();

class FakePerformanceObserver {
  private readonly cb: ObserverCallback;

  constructor(cb: ObserverCallback) {
    this.cb = cb;
  }

  observe(init: { type: string; buffered?: boolean }): void {
    if (unsupportedTypes.has(init.type)) {
      throw new TypeError(`unsupported entry type: ${init.type}`);
    }
    registered.set(init.type, this.cb);
  }

  disconnect(): void {
    disconnect();
  }
}

function deliver(type: string, entries: FakeEntry[]): void {
  const cb = registered.get(type);
  if (!cb) throw new Error(`no observer registered for ${type}`);
  cb({ getEntries: () => entries } as unknown as PerformanceObserverEntryList);
}

function stubNavigation(responseStart: number | undefined): void {
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) => {
    if (type === 'navigation' && responseStart !== undefined) {
      return [{ responseStart } as PerformanceNavigationTiming];
    }
    return [];
  });
}

async function load() {
  vi.resetModules();
  return import('@/lib/report-web-vitals');
}

function collector(): { metrics: WebVitalMetric[]; sink: (m: WebVitalMetric) => void } {
  const metrics: WebVitalMetric[] = [];
  return {
    metrics,
    sink: (m) => {
      metrics.push(m);
    },
  };
}

function rumBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    if (typeof init.body !== 'string') throw new Error('expected a JSON string body');
    return JSON.parse(init.body) as Record<string, unknown>;
  });
}

beforeEach(() => {
  registered.clear();
  unsupportedTypes = new Set();
  disconnect.mockReset();
  distribution.mockReset();
  vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
  stubNavigation(undefined);
});

afterEach(() => {
  // Each test imports a fresh module instance, but the hide listeners an
  // earlier instance bound to window/document outlive it. Drain whatever that
  // instance still has queued so it cannot post into the next test's fetch.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('reportWebVitals observers', () => {
  it('is a no-op when PerformanceObserver is unavailable', async () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();

    const unsub = reportWebVitals(sink);

    expect(registered.size).toBe(0);
    expect(metrics).toEqual([]);
    expect(() => {
      unsub();
    }).not.toThrow();
  });

  it('registers the four buffered observers and disconnects each on unsubscribe', async () => {
    const { reportWebVitals } = await load();

    const unsub = reportWebVitals(collector().sink);

    expect([...registered.keys()].sort()).toEqual([
      'event',
      'largest-contentful-paint',
      'layout-shift',
      'paint',
    ]);
    unsub();
    expect(disconnect).toHaveBeenCalledTimes(4);
  });

  it('skips entry types the browser rejects and keeps the rest', async () => {
    unsupportedTypes = new Set(['event', 'layout-shift']);
    const { reportWebVitals } = await load();

    const unsub = reportWebVitals(collector().sink);

    expect([...registered.keys()].sort()).toEqual(['largest-contentful-paint', 'paint']);
    unsub();
    // Only observers that were actually attached get disconnected.
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('survives a disconnect() that throws', async () => {
    disconnect.mockImplementation(() => {
      throw new Error('already disconnected');
    });
    const { reportWebVitals } = await load();

    const unsub = reportWebVitals(collector().sink);

    expect(() => {
      unsub();
    }).not.toThrow();
    expect(disconnect).toHaveBeenCalledTimes(4);
  });

  it('reports the LAST largest-contentful-paint entry and ignores an empty batch', async () => {
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();
    reportWebVitals(sink);

    deliver('largest-contentful-paint', []);
    expect(metrics).toEqual([]);

    deliver('largest-contentful-paint', [{ startTime: 900 }, { startTime: 3100 }]);
    expect(metrics).toEqual([
      { name: 'LCP', value: 3100, unit: 'ms', rating: 'needs-improvement' },
    ]);
  });

  it('reports FCP only for the first-contentful-paint entry', async () => {
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();
    reportWebVitals(sink);

    deliver('paint', [
      { name: 'first-paint', startTime: 400 },
      { name: 'first-contentful-paint', startTime: 1200 },
    ]);

    expect(metrics).toEqual([{ name: 'FCP', value: 1200, unit: 'ms', rating: 'good' }]);
  });

  it('accumulates CLS, skipping shifts after recent input and non-numeric values', async () => {
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();
    reportWebVitals(sink);

    deliver('layout-shift', [
      { value: 0.05 },
      { value: 0.5, hadRecentInput: true },
      {},
      { value: 0.1 },
    ]);
    deliver('layout-shift', [{ value: 0.2 }]);

    expect(metrics.map((m) => m.name)).toEqual(['CLS', 'CLS', 'CLS']);
    expect(metrics.map((m) => m.unit)).toEqual(['score', 'score', 'score']);
    expect(metrics[0]?.value).toBeCloseTo(0.05);
    expect(metrics[1]?.value).toBeCloseTo(0.15);
    expect(metrics[2]?.value).toBeCloseTo(0.35);
    expect(metrics.map((m) => m.rating)).toEqual(['good', 'needs-improvement', 'poor']);
  });

  it('tracks INP as the running maximum over real interactions only', async () => {
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();
    reportWebVitals(sink);

    deliver('event', [
      { duration: 900 }, // no interactionId — not an interaction
      { interactionId: 0, duration: 800 }, // interactionId 0 means "none"
      { interactionId: 1 }, // no duration
      { interactionId: 2, duration: 150 },
      { interactionId: 3, duration: 90 }, // lower than the current max
      { interactionId: 4, duration: 320 },
    ]);
    deliver('event', [{ interactionId: 5, duration: 320 }]); // equal — not a new max

    expect(metrics).toEqual([
      { name: 'INP', value: 150, unit: 'ms', rating: 'good' },
      { name: 'INP', value: 320, unit: 'ms', rating: 'needs-improvement' },
    ]);
  });

  it('emits TTFB from navigation timing at start-up', async () => {
    stubNavigation(120);
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();

    reportWebVitals(sink);

    expect(metrics).toEqual([{ name: 'TTFB', value: 120, unit: 'ms', rating: 'good' }]);
  });

  it('emits no TTFB without a navigation entry, or when navigation timing throws', async () => {
    const { reportWebVitals } = await load();
    const first = collector();
    reportWebVitals(first.sink);
    expect(first.metrics).toEqual([]);

    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('not supported');
    });
    const second = collector();
    expect(() => reportWebVitals(second.sink)).not.toThrow();
    expect(second.metrics).toEqual([]);
    // Observers are still attached even though navigation timing failed.
    expect(registered.size).toBe(4);
  });
});

describe('rating thresholds', () => {
  // Boundary values on both sides of each threshold (web.dev / CrUX).
  const cases: [string, FakeEntry[], WebVitalMetric['rating'][]][] = [
    [
      'largest-contentful-paint',
      [{ startTime: 2500 }],
      ['good'],
    ],
    ['largest-contentful-paint', [{ startTime: 4000 }], ['needs-improvement']],
    ['largest-contentful-paint', [{ startTime: 4001 }], ['poor']],
    [
      'paint',
      [
        { name: 'first-contentful-paint', startTime: 1800 },
        { name: 'first-contentful-paint', startTime: 3000 },
        { name: 'first-contentful-paint', startTime: 3001 },
      ],
      ['good', 'needs-improvement', 'poor'],
    ],
    [
      'event',
      [
        { interactionId: 1, duration: 200 },
        { interactionId: 2, duration: 500 },
        { interactionId: 3, duration: 501 },
      ],
      ['good', 'needs-improvement', 'poor'],
    ],
  ];

  it.each(cases)('%s %j → %j', async (type, entries, ratings) => {
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();
    reportWebVitals(sink);

    deliver(type, entries);

    expect(metrics.map((m) => m.rating)).toEqual(ratings);
  });

  it.each([
    [800, 'good'],
    [1800, 'needs-improvement'],
    [1801, 'poor'],
  ] as const)('TTFB %d → %s', async (responseStart, rating) => {
    stubNavigation(responseStart);
    const { reportWebVitals } = await load();
    const { metrics, sink } = collector();

    reportWebVitals(sink);

    expect(metrics[0]?.rating).toBe(rating);
  });
});

describe('default sink', () => {
  it('logs to the console in development and sends nothing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    stubNavigation(123.6);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { reportWebVitals } = await load();

    reportWebVitals();
    deliver('layout-shift', [{ value: 0.12345 }]);

    // ms metrics are rounded to whole ms with a unit; CLS keeps 3 decimals and no unit.
    expect(info.mock.calls.map((c) => String(c[0]))).toEqual([
      '[web-vitals] TTFB=124ms (good)',
      '[web-vitals] CLS=0.123 (needs-improvement)',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(distribution).not.toHaveBeenCalled();
  });

  it('in production sends each metric to Sentry with unit and rating attributes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    stubNavigation(2000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { reportWebVitals } = await load();

    reportWebVitals();
    deliver('layout-shift', [{ value: 0.3 }]);

    expect(distribution.mock.calls).toEqual([
      ['web_vital.ttfb', 2000, { unit: 'millisecond', attributes: { rating: 'poor' } }],
      ['web_vital.cls', 0.3, { unit: 'none', attributes: { rating: 'poor' } }],
    ]);
    expect(info).not.toHaveBeenCalled();
  });

  it('in production POSTs TTFB and FCP immediately, once each', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.no-markup.com/');
    stubNavigation(300);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { reportWebVitals } = await load();

    reportWebVitals();
    deliver('paint', [{ name: 'first-contentful-paint', startTime: 1000 }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Trailing slash on the base is trimmed — no `//api/v1/rum`.
    expect(fetchMock.mock.calls.map((c) => c[0] as string)).toEqual([
      'https://api.no-markup.com/api/v1/rum',
      'https://api.no-markup.com/api/v1/rum',
    ]);
    expect(rumBodies(fetchMock).map((b) => [b['name'], b['value']])).toEqual([
      ['TTFB', 300],
      ['FCP', 1000],
    ]);
  });
});

describe('queueFieldRum', () => {
  const lcp = (value: number): WebVitalMetric => ({
    name: 'LCP',
    value,
    unit: 'ms',
    rating: 'good',
  });

  it('holds LCP/INP/CLS and sends only the latest value after 4s', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { queueFieldRum } = await load();

    queueFieldRum(lcp(1000));
    queueFieldRum(lcp(1400));
    queueFieldRum({ name: 'CLS', value: 0.02, unit: 'score', rating: 'good' });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3999);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(rumBodies(fetchMock).map((b) => [b['name'], b['value']])).toEqual([
      ['LCP', 1400],
      ['CLS', 0.02],
    ]);
  });

  it('arms the 4s timer once per metric — later updates wait for page hide', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { queueFieldRum } = await load();

    queueFieldRum(lcp(1000));
    vi.advanceTimersByTime(4000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    queueFieldRum(lcp(2200));
    vi.advanceTimersByTime(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    expect(rumBodies(fetchMock).map((b) => b['value'])).toEqual([1000, 2200]);
  });

  it('flushes on visibilitychange only when the page becomes hidden', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    const { queueFieldRum } = await load();

    queueFieldRum({ name: 'INP', value: 180, unit: 'ms', rating: 'good' });

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).not.toHaveBeenCalled();

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rumBodies(fetchMock).map((b) => [b['name'], b['value']])).toEqual([['INP', 180]]);

    // Already flushed: the 4s timer finds nothing left and does not double-send.
    vi.advanceTimersByTime(4000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('binds the hide listeners once, however many metrics are queued', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const docAdd = vi.spyOn(document, 'addEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const { queueFieldRum } = await load();

    queueFieldRum(lcp(1));
    queueFieldRum(lcp(2));
    queueFieldRum({ name: 'TTFB', value: 50, unit: 'ms', rating: 'good' });

    expect(docAdd.mock.calls.filter((c) => c[0] === 'visibilitychange')).toHaveLength(1);
    expect(winAdd.mock.calls.filter((c) => c[0] === 'pagehide')).toHaveLength(1);
  });
});

describe('postFieldRum / sanitizeRumPath edge cases', () => {
  it('sends the current pathname without its query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/jobs/abc?token=secret#frag');
    const { postFieldRum } = await load();

    postFieldRum({ name: 'FCP', value: 10, unit: 'ms', rating: 'good' });

    expect(rumBodies(fetchMock)[0]?.['path']).toBe('/jobs/abc');
    window.history.pushState({}, '', '/');
  });

  it('swallows a rejected fetch promise', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { postFieldRum } = await load();

    expect(() => {
      postFieldRum({ name: 'FCP', value: 10, unit: 'ms', rating: 'good' });
    }).not.toThrow();
    // Let the rejection settle: an unhandled rejection would fail the run.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls back to cutting at ? or # when the input cannot be parsed as a URL', async () => {
    const { sanitizeRumPath } = await load();

    // `http://[` is an invalid absolute URL even with a base → catch branch.
    expect(sanitizeRumPath('http://[?x=1')).toBe('http://[');
    expect(sanitizeRumPath('http://[#frag')).toBe('http://[');
    expect(sanitizeRumPath('http://[')).toBe('http://[');
  });

  it('uses a same-origin path when NEXT_PUBLIC_API_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    const { rumIngestURL } = await load();

    expect(rumIngestURL()).toBe('/api/v1/rum');
  });
});
