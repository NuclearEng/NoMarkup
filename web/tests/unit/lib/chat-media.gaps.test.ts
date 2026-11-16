// chat-media — how the configured S3 host is parsed (no scheme, blank,
// unparseable), the server render with no window, loopback path rules, and
// schemes other than http(s).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAllowedChatMediaUrl } from '@/lib/chat-media';

function configureS3(value: string): void {
  vi.stubEnv('NEXT_PUBLIC_S3_PUBLIC_URL', value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isAllowedChatMediaUrl — configured storage host', () => {
  it('accepts the host from a config value written without a scheme', () => {
    configureS3('cdn.nomarkup.test/media');
    expect(isAllowedChatMediaUrl('https://cdn.nomarkup.test/media/a.webp')).toBe(true);
    expect(isAllowedChatMediaUrl('http://cdn.nomarkup.test/media/a.webp')).toBe(true);
  });

  it('matches the host case-insensitively and ignores a trailing dot', () => {
    configureS3('https://CDN.NoMarkup.test');
    expect(isAllowedChatMediaUrl('https://cdn.nomarkup.test./a.webp')).toBe(true);
  });

  it.each([
    ['whitespace only', '   '],
    ['an unparseable value', 'https://exa mple.com'],
  ])('adds no extra host when the config is %s', (_name, value) => {
    configureS3(value);
    expect(isAllowedChatMediaUrl('https://cdn.nomarkup.test/media/a.webp')).toBe(false);
    // Fixture hosts are unaffected.
    expect(isAllowedChatMediaUrl('https://picsum.photos/200')).toBe(true);
  });

  it('does not treat a sibling or parent domain of the configured host as allowed', () => {
    configureS3('https://cdn.nomarkup.test');
    expect(isAllowedChatMediaUrl('https://evil-cdn.nomarkup.test/a.webp')).toBe(false);
    expect(isAllowedChatMediaUrl('https://nomarkup.test/a.webp')).toBe(false);
  });
});

describe('isAllowedChatMediaUrl — page origin', () => {
  it('allows the page’s own host in the browser but not on the server (no window)', () => {
    const ownHost = window.location.hostname;
    const url = `http://${ownHost}/bucket/key.webp`;
    expect(isAllowedChatMediaUrl(url)).toBe(true);

    vi.stubGlobal('window', undefined);
    configureS3('');
    const onServer = {
      fixture: isAllowedChatMediaUrl('https://images.unsplash.com/photo-1'),
      other: isAllowedChatMediaUrl('https://media.nomarkup.test/a.webp'),
    };
    vi.unstubAllGlobals();

    expect(onServer).toEqual({ fixture: true, other: false });
  });
});

describe('isAllowedChatMediaUrl — loopback and scheme rules', () => {
  it.each([
    ['https with a bucket/key path', 'https://localhost:9000/nomarkup-media/chat/a.webp', true],
    ['https with only one path segment', 'https://localhost:9000/favicon.ico', false],
    ['https with no path', 'https://127.0.0.1/', false],
    ['http with a bucket/key path', 'http://127.0.0.1:9000/nomarkup-media/a.webp', true],
    ['http with a bucket name that starts with a dot', 'http://localhost:9000/.hidden/a.webp', false],
  ])('%s → %s', (_name, url, expected) => {
    expect(isAllowedChatMediaUrl(url)).toBe(expected);
  });

  it('rejects plain http for fixture hosts (https only)', () => {
    expect(isAllowedChatMediaUrl('http://images.unsplash.com/photo-1')).toBe(false);
  });

  it.each(['ftp://localhost/bucket/key', 'ws://localhost/bucket/key', 'blob:https://localhost/uuid'])(
    'rejects the non-http(s) URL %s even on an allowed host',
    (url) => {
      expect(isAllowedChatMediaUrl(url)).toBe(false);
    },
  );

  it.each([
    ['credentials in the URL', 'https://user:pw@images.unsplash.com/photo-1'],
    ['an embedded space', 'https://images.unsplash.com/photo 1'],
    ['an angle bracket', 'https://images.unsplash.com/<script>'],
    ['a relative path', '/uploads/a.webp'],
    ['null', null],
    ['whitespace', '   '],
  ])('rejects %s', (_name, url) => {
    expect(isAllowedChatMediaUrl(url)).toBe(false);
  });
});
