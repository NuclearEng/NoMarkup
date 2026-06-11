import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { resetRateLimit } from '@/lib/server/rate-limit';

// ── JWT test key — the route now VERIFIES tokens (RS256 sig, exp, iss,
// aud), so tests sign real tokens and point JWT_PUBLIC_KEY_PATH at the
// matching public key.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: wrongPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const PEM_PATH = join(mkdtempSync(join(tmpdir(), 'nomarkup-route-jwt-')), 'public.pem');
writeFileSync(PEM_PATH, publicKey.export({ type: 'spki', format: 'pem' }));
process.env['JWT_PUBLIC_KEY_PATH'] = PEM_PATH;

function signTestToken(
  overrides: Record<string, unknown> = {},
  key: KeyObject = privateKey,
): string {
  const nowS = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://auth.nomarkup.com',
    aud: ['nomarkup-api'],
    sub: 'user-123',
    iat: nowS,
    exp: nowS + 900,
    email: 'a@b.com',
    roles: ['customer'],
    ...overrides,
  };
  const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`;
  const sig = cryptoSign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url');
  return `${signingInput}.${sig}`;
}

// ── Anthropic SDK mock ────────────────────────────────────────────────
const messagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    // Vitest 4 constructs mock implementations with Reflect.construct, so the
    // `new Anthropic(...)` call needs a constructible `function` implementation.
    default: vi.fn().mockImplementation(function () {
      return {
        messages: { create: messagesCreate },
      };
    }),
  };
});

const { POST } = await import('@/app/api/analyze-listing-image/route');

// ── Helpers ───────────────────────────────────────────────────────────
interface RequestOptions {
  body?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  contentType?: string | null;
  contentLength?: string | null;
}

function buildRequest(opts: RequestOptions = {}): NextRequest {
  const headers = new Headers();
  if (opts.contentType !== null) {
    headers.set('content-type', opts.contentType ?? 'application/json');
  }
  if (opts.contentLength !== undefined && opts.contentLength !== null) {
    headers.set('content-length', opts.contentLength);
  }
  if (opts.cookies && Object.keys(opts.cookies).length > 0) {
    const cookieValue = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('cookie', cookieValue);
  }
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers.set(k, v);
  }

  return new NextRequest('http://localhost/api/analyze-listing-image', {
    method: 'POST',
    headers,
    body: opts.body,
  });
}

const VALID_BASE64 = Buffer.from('fake-image-bytes').toString('base64');

const VALID_BODY = JSON.stringify({
  imageBase64: VALID_BASE64,
  mimeType: 'image/jpeg',
});

// A verified JWT delivered via the oauth_access_token cookie (the gate's
// cookie fallback) — keeps the non-auth tests cookie-shaped as before.
const AUTH_COOKIES = { oauth_access_token: signTestToken() };

function mockSuccessResponse(text: string): void {
  messagesCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

const VALID_AI_JSON = JSON.stringify({
  category_slug: 'goods-furniture',
  title: 'IKEA Markus office chair, black',
  description:
    'Solid black mesh-back office chair with adjustable lumbar support. Light wear on armrests, otherwise excellent condition. No tears or stains.',
  suggested_starting_price_cents: 4500,
  condition: 'very_good',
  confidence: 'high',
});

beforeEach(() => {
  messagesCreate.mockReset();
  resetRateLimit();
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  process.env['JWT_PUBLIC_KEY_PATH'] = PEM_PATH;
});

afterEach(() => {
  delete process.env['ANTHROPIC_API_KEY'];
});

// ── Auth tests — the route VERIFIES the access JWT, not just presence ──
describe('POST /api/analyze-listing-image — auth', () => {
  it('returns 401 when no auth cookie or bearer header is present', async () => {
    const req = buildRequest({ body: VALID_BODY });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a bare has_session=1 cookie (presence is not proof)', async () => {
    const req = buildRequest({ body: VALID_BODY, cookies: { has_session: '1' } });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects a bare refresh_token cookie (not verifiable by the web tier)', async () => {
    const req = buildRequest({ body: VALID_BODY, cookies: { refresh_token: 'rt-abc' } });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('accepts a valid signed JWT via Authorization: Bearer', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: `Bearer ${signTestToken()}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('accepts a valid signed JWT via the oauth_access_token cookie', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({
      body: VALID_BODY,
      cookies: { oauth_access_token: signTestToken() },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('rejects an opaque (non-JWT) bearer token', async () => {
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: 'Bearer xyz123' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects an expired token', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const expired = signTestToken({ iat: nowS - 1800, exp: nowS - 900 });
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: `Bearer ${expired}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong key', async () => {
    const forged = signTestToken({}, wrongPrivateKey);
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: `Bearer ${forged}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects a token with the wrong issuer', async () => {
    const wrongIss = signTestToken({ iss: 'https://evil.example.com' });
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: `Bearer ${wrongIss}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects a token with the wrong audience', async () => {
    const wrongAud = signTestToken({ aud: ['some-other-api'] });
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: `Bearer ${wrongAud}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects malformed Authorization header', async () => {
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: 'Basic abc' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── Per-user rate limit ───────────────────────────────────────────────
describe('POST /api/analyze-listing-image — rate limit', () => {
  it('allows 10 requests/min per user then returns 429 with Retry-After', async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: VALID_AI_JSON }],
    });
    const token = signTestToken();

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(
        buildRequest({ body: VALID_BODY, headers: { authorization: `Bearer ${token}` } }),
      );
      expect(res.status).toBe(200);
    }

    const blocked = await POST(
      buildRequest({ body: VALID_BODY, headers: { authorization: `Bearer ${token}` } }),
    );
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    // A different user (sub) is NOT affected by user-123's exhaustion.
    const otherUser = signTestToken({ sub: 'user-456' });
    const other = await POST(
      buildRequest({ body: VALID_BODY, headers: { authorization: `Bearer ${otherUser}` } }),
    );
    expect(other.status).toBe(200);
  });
});

// ── Content-Type / body-size guards ───────────────────────────────────
describe('POST /api/analyze-listing-image — request guards', () => {
  it('returns 415 when Content-Type is missing', async () => {
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      contentType: null,
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it('returns 415 when Content-Type is not JSON', async () => {
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      contentType: 'text/plain',
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it('accepts application/json with charset suffix', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      contentType: 'Application/JSON; charset=utf-8',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('returns 413 when Content-Length exceeds the body cap', async () => {
    const huge = String(50 * 1024 * 1024); // 50 MB
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      contentLength: huge,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload too large' });
  });

  it('ignores a non-numeric Content-Length', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      contentLength: 'not-a-number',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ── Env-var guard ─────────────────────────────────────────────────────
describe('POST /api/analyze-listing-image — env config', () => {
  it('degrades to 503 + aiUnavailable when ANTHROPIC_API_KEY is missing', async () => {
    // AI photo analysis is an enhancement: a missing key must NOT 500. It
    // returns a clean 503 so the sell flow keeps working without AI.
    delete process.env['ANTHROPIC_API_KEY'];
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      aiUnavailable: true,
      error: 'AI photo analysis is not configured.',
    });
  });
});

// ── JSON parsing + schema validation ──────────────────────────────────
describe('POST /api/analyze-listing-image — body validation', () => {
  it('returns 400 on invalid JSON', async () => {
    const req = buildRequest({
      body: '{not valid json',
      cookies: AUTH_COOKIES,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when imageBase64 is missing', async () => {
    const req = buildRequest({
      body: JSON.stringify({ mimeType: 'image/jpeg' }),
      cookies: AUTH_COOKIES,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when an extra field is present (strict schema)', async () => {
    const req = buildRequest({
      body: JSON.stringify({
        imageBase64: VALID_BASE64,
        mimeType: 'image/jpeg',
        model: 'claude-opus',
      }),
      cookies: AUTH_COOKIES,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 413 when imageBase64 exceeds the size cap', async () => {
    const tooBig = 'A'.repeat(7_000_000);
    const req = buildRequest({
      body: JSON.stringify({ imageBase64: tooBig, mimeType: 'image/jpeg' }),
      cookies: AUTH_COOKIES,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload too large' });
  });

  it('returns 400 on unsupported MIME type', async () => {
    const req = buildRequest({
      body: JSON.stringify({
        imageBase64: VALID_BASE64,
        mimeType: 'image/bmp',
      }),
      cookies: AUTH_COOKIES,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ── AI call: happy path & validation ──────────────────────────────────
describe('POST /api/analyze-listing-image — AI call', () => {
  it('returns parsed fields on a successful response', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      categorySlug: 'goods-furniture',
      title: 'IKEA Markus office chair, black',
      description:
        'Solid black mesh-back office chair with adjustable lumbar support. Light wear on armrests, otherwise excellent condition. No tears or stains.',
      suggestedStartingPriceCents: 4500,
      condition: 'very_good',
      confidence: 'high',
    });

    // Hard-coded model — never client-controlled.
    expect(messagesCreate).toHaveBeenCalledTimes(1);
    const callArg = messagesCreate.mock.calls[0]?.[0] as {
      model: string;
      max_tokens: number;
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    expect(callArg.model).toBe('claude-haiku-4-5-20251001');
    expect(callArg.max_tokens).toBe(512);
    expect(callArg.messages[0]?.content[0]?.type).toBe('image');
    expect(callArg.messages[0]?.content[1]?.type).toBe('text');
  });

  it('strips ```json fenced code blocks before parsing', async () => {
    mockSuccessResponse('```json\n' + VALID_AI_JSON + '\n```');
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('degrades to 503 + aiUnavailable when the SDK call throws', async () => {
    // A provider outage / rate limit is a predictable failure for an optional
    // enhancement — degrade gracefully rather than surfacing a hard error.
    messagesCreate.mockRejectedValueOnce(new Error('upstream 500'));
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      aiUnavailable: true,
      error: 'AI photo analysis is temporarily unavailable.',
    });
  });

  it('returns 400 when the AI returns non-JSON text', async () => {
    mockSuccessResponse('I cannot help with that.');
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'AI returned non-JSON response' });
  });

  it('returns 400 when category_slug is not in the allowed enum', async () => {
    mockSuccessResponse(
      JSON.stringify({
        category_slug: 'goods-illegal',
        title: 'x',
        description: 'y',
        suggested_starting_price_cents: 1000,
        condition: 'good',
        confidence: 'medium',
      }),
    );
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when suggested_starting_price_cents is zero or negative', async () => {
    mockSuccessResponse(
      JSON.stringify({
        category_slug: 'goods-furniture',
        title: 'x',
        description: 'y',
        suggested_starting_price_cents: 0,
        condition: 'good',
        confidence: 'medium',
      }),
    );
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when suggested_starting_price_cents exceeds $100k cap', async () => {
    mockSuccessResponse(
      JSON.stringify({
        category_slug: 'goods-furniture',
        title: 'x',
        description: 'y',
        suggested_starting_price_cents: 100_000_01 * 100, // way over cap
        condition: 'good',
        confidence: 'medium',
      }),
    );
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when condition is not in the allowed enum', async () => {
    mockSuccessResponse(
      JSON.stringify({
        category_slug: 'goods-furniture',
        title: 'x',
        description: 'y',
        suggested_starting_price_cents: 1000,
        condition: 'pristine', // invalid
        confidence: 'medium',
      }),
    );
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when title exceeds 80 chars', async () => {
    mockSuccessResponse(
      JSON.stringify({
        category_slug: 'goods-furniture',
        title: 'x'.repeat(200),
        description: 'y',
        suggested_starting_price_cents: 1000,
        condition: 'good',
        confidence: 'medium',
      }),
    );
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
