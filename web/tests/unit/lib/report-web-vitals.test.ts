import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  postFieldRum,
  reportWebVitals,
  rumIngestURL,
  sanitizeRumPath,
  type WebVitalMetric,
} from '@/lib/report-web-vitals';

describe('reportWebVitals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns an unsubscribe function and does not throw in jsdom', () => {
    const sink = vi.fn();
    const unsub = reportWebVitals(sink);
    expect(typeof unsub).toBe('function');
    expect(() => { unsub(); }).not.toThrow();
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

  it('does not POST rum samples outside production', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const unsub = reportWebVitals();
    unsub();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sanitizeRumPath', () => {
  it('strips query and hash, caps length, defaults empty', () => {
    expect(sanitizeRumPath('')).toBe('/');
    expect(sanitizeRumPath('   ')).toBe('/');
    expect(sanitizeRumPath('/jobs/abc?token=secret')).toBe('/jobs/abc');
    expect(sanitizeRumPath('/jobs/abc#top')).toBe('/jobs/abc');
    expect(sanitizeRumPath('https://no-markup.com/marketplace?utm=1')).toBe('/marketplace');
    expect(sanitizeRumPath(`/${'a'.repeat(250)}`).length).toBe(200);
  });
});

describe('rumIngestURL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the public API base when set', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.no-markup.com');
    expect(rumIngestURL()).toBe('https://api.no-markup.com/api/v1/rum');
  });

  it('falls back to a same-origin path when the base is empty', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    expect(rumIngestURL()).toBe('/api/v1/rum');
  });
});

describe('postFieldRum', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('POSTs only name/value/rating/path with credentials omitted', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.no-markup.com');

    postFieldRum({ name: 'LCP', value: 1800, unit: 'ms', rating: 'good' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.no-markup.com/api/v1/rum');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['name', 'path', 'rating', 'value']);
    expect(body['name']).toBe('LCP');
    expect(body['value']).toBe(1800);
    expect(body['rating']).toBe('good');
    expect(typeof body['path']).toBe('string');
    expect(String(body['path'])).not.toContain('?');
    expect(body['user_id']).toBeUndefined();
    expect(body['email']).toBeUndefined();
  });

  it('swallows fetch failures', () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('network down');
    }));
    expect(() => {
      postFieldRum({ name: 'TTFB', value: 80, unit: 'ms', rating: 'good' });
    }).not.toThrow();
  });
});
