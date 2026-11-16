import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  collectServerEnvIssues,
  validateServerEnv,
} from '@/lib/server/env';

/** A fully valid production env. */
function validEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    API_URL: 'https://api.no-markup.com',
    NEXT_PUBLIC_SITE_URL: 'https://no-markup.com',
    NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.test-token',
    NEXT_PUBLIC_WS_URL: 'wss://api.no-markup.com',
    JWT_PUBLIC_KEY_PATH: './keys/public.pem',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectServerEnvIssues', () => {
  it('returns no issues when every required var is set and valid', () => {
    expect(collectServerEnvIssues(validEnv())).toEqual([]);
  });

  it('reports every missing var, not just the first', () => {
    const issues = collectServerEnvIssues({});
    const names = issues.map((i) => i.name).sort();
    expect(names).toEqual([
      'API_URL',
      'JWT_PUBLIC_KEY_PATH',
      'NEXT_PUBLIC_MAPBOX_TOKEN',
      'NEXT_PUBLIC_SITE_URL',
      'NEXT_PUBLIC_WS_URL',
    ]);
    for (const issue of issues) {
      expect(issue.message).toBe('Required');
    }
  });

  it('treats empty strings as missing (VAR= in an env file)', () => {
    const env = validEnv();
    env['NEXT_PUBLIC_MAPBOX_TOKEN'] = '';
    const issues = collectServerEnvIssues(env);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.name).toBe('NEXT_PUBLIC_MAPBOX_TOKEN');
    expect(issues[0]?.message).toBe('Required');
  });

  it('flags non-URL values for URL-typed vars', () => {
    const env = validEnv();
    env['API_URL'] = 'not a url';
    const issues = collectServerEnvIssues(env);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.name).toBe('API_URL');
  });

  it('accepts ws:// and wss:// schemes for NEXT_PUBLIC_WS_URL', () => {
    const env = validEnv();
    env['NEXT_PUBLIC_WS_URL'] = 'ws://localhost:8080';
    expect(collectServerEnvIssues(env)).toEqual([]);
  });

  it('ignores unrelated vars', () => {
    const env = validEnv();
    env['SOME_RANDOM_VAR'] = 'whatever';
    expect(collectServerEnvIssues(env)).toEqual([]);
  });
});

describe('validateServerEnv', () => {
  it('does nothing when the env is complete', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* silence dev warning in test output */
    });
    expect(() => { validateServerEnv(validEnv()); }).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws in production with an aggregated message naming every missing var', () => {
    const env = validEnv();
    delete env['API_URL'];
    delete env['JWT_PUBLIC_KEY_PATH'];

    let thrown: Error | undefined;
    try {
      validateServerEnv(env);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toContain('API_URL');
    expect(thrown?.message).toContain('JWT_PUBLIC_KEY_PATH');
    expect(thrown?.message).toContain('.env.example');
  });

  it('logs a structured warning instead of throwing in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* silence dev warning in test output */
    });
    const env = validEnv();
    env['NODE_ENV'] = 'development';
    delete env['NEXT_PUBLIC_WS_URL'];

    expect(() => { validateServerEnv(env); }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as {
      level: string;
      service: string;
      missing: string[];
    };
    expect(payload.level).toBe('warn');
    expect(payload.service).toBe('web');
    expect(payload.missing).toEqual(['NEXT_PUBLIC_WS_URL']);
  });

  it('does not throw in development even when everything is missing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {
      /* silence dev warning in test output */
    });
    expect(() => { validateServerEnv({ NODE_ENV: 'development' }); }).not.toThrow();
  });
});
