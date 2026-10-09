import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAllowedChatMediaUrl } from '@/lib/chat-media';

describe('isAllowedChatMediaUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      name: 'localhost minio object',
      raw: 'http://localhost:9000/nomarkup-dev/chat/obj.jpg',
      want: true,
    },
    {
      name: '127.0.0.1 minio object',
      raw: 'http://127.0.0.1:9000/nomarkup-dev/chat/obj.jpg',
      want: true,
    },
    {
      name: 'https localhost object',
      raw: 'https://localhost:9000/nomarkup-dev/chat/obj.jpg',
      want: true,
    },
    {
      name: 'unsplash fixture',
      raw: 'https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=800',
      want: true,
    },
    {
      name: 'picsum fixture',
      raw: 'https://picsum.photos/id/1015/800/600',
      want: true,
    },
    {
      name: 'evil https host',
      raw: 'https://evil.example.com/tracker.png',
      want: false,
    },
    {
      name: 'suffix confusion',
      raw: 'https://images.unsplash.com.evil.test/p.jpg',
      want: false,
    },
    {
      name: 'javascript scheme',
      raw: 'javascript:alert(1)',
      want: false,
    },
    {
      name: 'data uri',
      raw: 'data:image/png;base64,abcd',
      want: false,
    },
    {
      name: 'relative path',
      raw: '/nomarkup-dev/chat/obj.jpg',
      want: false,
    },
    {
      name: 'protocol-relative',
      raw: '//evil.example.com/phish',
      want: false,
    },
    {
      name: 'whitespace inside',
      raw: 'http://localhost:9000/nomarkup-dev/chat/obj jpg',
      want: false,
    },
    {
      name: 'angle brackets',
      raw: 'http://localhost:9000/nomarkup-dev/<script>',
      want: false,
    },
    {
      name: 'empty',
      raw: '',
      want: false,
    },
    {
      name: 'loopback missing object key',
      raw: 'http://localhost:9000/nomarkup-dev',
      want: false,
    },
    {
      name: 'userinfo',
      raw: 'https://user:pass@picsum.photos/id/1/1/1',
      want: false,
    },
  ])('$name', ({ raw, want }) => {
    expect(isAllowedChatMediaUrl(raw)).toBe(want);
  });

  it('accepts NEXT_PUBLIC_S3_PUBLIC_URL host', () => {
    vi.stubEnv('NEXT_PUBLIC_S3_PUBLIC_URL', 'http://192.168.1.101:9000/nomarkup-dev');
    expect(isAllowedChatMediaUrl('http://192.168.1.101:9000/nomarkup-dev/chat/obj.jpg')).toBe(
      true,
    );
    expect(isAllowedChatMediaUrl('https://evil.example.com/a.jpg')).toBe(false);
  });

  it('rejects over-long URLs', () => {
    expect(isAllowedChatMediaUrl(`https://picsum.photos/${'a'.repeat(2000)}`)).toBe(false);
  });
});
