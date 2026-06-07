import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Anthropic SDK mock ────────────────────────────────────────────────
// The route does `new Anthropic({ apiKey })` and then calls
// `client.messages.create(...)`. We need to be able to control the
// resolved value (or thrown error) per-test.
const messagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  // The SDK is imported as the default export.
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: messagesCreate },
    })),
  };
});

// Late-import the route after the mock is registered.
const { POST } = await import('@/app/api/analyze-job-image/route');

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

  return new NextRequest('http://localhost/api/analyze-job-image', {
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

const AUTH_COOKIES = { has_session: '1' };

function mockSuccessResponse(text: string): void {
  messagesCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

const VALID_AI_JSON = JSON.stringify({
  category: 'plumbing',
  title: 'Fix leaky faucet',
  description: 'Replace the kitchen faucet washer. Looks like a quick job.',
  budget_min_cents: 5000,
  budget_max_cents: 15000,
});

beforeEach(() => {
  messagesCreate.mockReset();
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
});

afterEach(() => {
  delete process.env['ANTHROPIC_API_KEY'];
});

// ── Auth tests ────────────────────────────────────────────────────────
describe('POST /api/analyze-job-image — auth', () => {
  it('returns 401 when no auth cookie or bearer header is present', async () => {
    const req = buildRequest({ body: VALID_BODY });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('accepts has_session=1 cookie', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({ body: VALID_BODY, cookies: { has_session: '1' } });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('rejects has_session cookie that is not "1"', async () => {
    const req = buildRequest({ body: VALID_BODY, cookies: { has_session: '0' } });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('accepts refresh_token cookie', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({ body: VALID_BODY, cookies: { refresh_token: 'rt-abc' } });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('accepts oauth_access_token cookie', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({ body: VALID_BODY, cookies: { oauth_access_token: 'oat-1' } });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('accepts Authorization: Bearer header', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({
      body: VALID_BODY,
      headers: { authorization: 'Bearer xyz123' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
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

// ── Origin guard ──────────────────────────────────────────────────────
describe('POST /api/analyze-job-image — origin', () => {
  it('returns 403 for a cross-origin Origin header', async () => {
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      headers: { origin: 'https://evil.example.com' },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('accepts a same-origin Origin header', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      headers: { origin: 'http://localhost' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('rejects a cross-origin Referer when no Origin is present', async () => {
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      headers: { referer: 'https://evil.example.com/page' },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

// ── Content-Type / body-size guards ───────────────────────────────────
describe('POST /api/analyze-job-image — request guards', () => {
  it('returns 415 when Content-Type is missing', async () => {
    const req = buildRequest({
      body: VALID_BODY,
      cookies: AUTH_COOKIES,
      contentType: null,
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' });
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
describe('POST /api/analyze-job-image — env config', () => {
  it('returns 500 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'ANTHROPIC_API_KEY not configured' });
  });
});

// ── JSON parsing + schema validation ──────────────────────────────────
describe('POST /api/analyze-job-image — body validation', () => {
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
    expect(await res.json()).toEqual({
      error: 'imageBase64 and mimeType are required',
    });
  });

  it('returns 400 when mimeType is missing', async () => {
    const req = buildRequest({
      body: JSON.stringify({ imageBase64: VALID_BASE64 }),
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
    // Just over the 5 MB raw → base64 ceiling.
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
    expect(await res.json()).toEqual({
      error: 'Unsupported image type. Use jpeg, png, gif, or webp.',
    });
  });

  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])(
    'accepts supported MIME type %s',
    async (mime) => {
      mockSuccessResponse(VALID_AI_JSON);
      const req = buildRequest({
        body: JSON.stringify({ imageBase64: VALID_BASE64, mimeType: mime }),
        cookies: AUTH_COOKIES,
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    },
  );
});

// ── Anthropic interaction + response handling ─────────────────────────
describe('POST /api/analyze-job-image — AI call', () => {
  it('returns parsed fields on a successful response', async () => {
    mockSuccessResponse(VALID_AI_JSON);
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      category: 'plumbing',
      title: 'Fix leaky faucet',
      description: 'Replace the kitchen faucet washer. Looks like a quick job.',
      budgetMinCents: 5000,
      budgetMaxCents: 15000,
    });

    // The route MUST hard-code the model — make sure the client never sees
    // any user-controlled override.
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
    const json = (await res.json()) as { category: string };
    expect(json.category).toBe('plumbing');
  });

  it('strips bare ``` fences (no language tag)', async () => {
    mockSuccessResponse('```\n' + VALID_AI_JSON + '\n```');
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('returns 502 when the SDK call throws', async () => {
    messagesCreate.mockRejectedValueOnce(new Error('upstream 500'));
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to analyze image' });
  });

  it('returns 502 when response.content is empty', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [] });
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Unexpected response format from AI' });
  });

  it('returns 502 when the first content block is not text', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }],
    });
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });

  it('returns 400 when the AI returns non-JSON text', async () => {
    mockSuccessResponse('I am sorry, I cannot help with that.');
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'AI returned non-JSON response' });
  });

  it('returns 400 when the AI JSON is missing required fields', async () => {
    mockSuccessResponse(JSON.stringify({ category: 'plumbing', title: 'x' }));
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'AI response missing required fields' });
  });

  it('returns 400 when budget fields are not integers', async () => {
    mockSuccessResponse(
      JSON.stringify({
        category: 'plumbing',
        title: 'x',
        description: 'y',
        budget_min_cents: 100.5,
        budget_max_cents: 200,
      }),
    );
    const req = buildRequest({ body: VALID_BODY, cookies: AUTH_COOKIES });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
