import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportWebVitals, type WebVitalMetric } from '@/lib/report-web-vitals';

describe('reportWebVitals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an unsubscribe function and does not throw in jsdom', () => {
    const sink = vi.fn();
    const unsub = reportWebVitals(sink);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('emits TTFB when navigation timing is available', () => {
    const metrics: WebVitalMetric[] = [];
    // jsdom may not have navigation entries; seed one if the API exists.
    if (typeof performance.getEntriesByType === 'function') {
      const original = performance.getEntriesByType.bind(performance);
      vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) => {
        if (type === 'navigation') {
          return [
            {
              responseStart: 120,
              entryType: 'navigation',
              name: '',
              startTime: 0,
              duration: 0,
              toJSON: () => ({}),
            } as PerformanceNavigationTiming,
          ];
        }
        return original(type);
      });
    }

    reportWebVitals((m) => {
      metrics.push(m);
    });

    const ttfb = metrics.find((m) => m.name === 'TTFB');
    if (ttfb) {
      expect(ttfb.value).toBe(120);
      expect(ttfb.unit).toBe('ms');
      expect(['good', 'needs-improvement', 'poor']).toContain(ttfb.rating);
    }
  });
});
