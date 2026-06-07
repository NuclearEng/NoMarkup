import Anthropic from '@anthropic-ai/sdk';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Hard-coded model — the client MUST NOT influence model selection. This
// prevents an attacker from forcing an expensive model (e.g. claude-opus) on
// every call.
const MODEL_ID = 'claude-haiku-4-5-20251001';

// 5 MB of raw image bytes → base64-encoded is ~5 MB * 4/3.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LEN = Math.ceil((MAX_IMAGE_BYTES * 4) / 3);
// Generous ceiling for the full JSON payload (base64 + small envelope).
const MAX_BODY_BYTES = MAX_BASE64_LEN + 4 * 1024;

const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type SupportedMimeType = (typeof supportedMimeTypes)[number];
const isSupportedMimeType = (mime: string): mime is SupportedMimeType =>
  (supportedMimeTypes as readonly string[]).includes(mime);

// `.strict()` rejects unknown fields — stops a client from smuggling in a
// `model` override or other unapproved parameters.
const requestSchema = z
  .object({
    imageBase64: z.string().min(1).max(MAX_BASE64_LEN, 'image too large'),
    mimeType: z.string().min(1),
  })
  .strict();

const claudeResponseSchema = z.object({
  category: z.string(),
  title: z.string(),
  description: z.string(),
  budget_min_cents: z.number().int(),
  budget_max_cents: z.number().int(),
});

function hasAuth(request: NextRequest): boolean {
  const cookies = request.cookies;
  if (cookies.get('has_session')?.value === '1') return true;
  if (cookies.get('refresh_token')?.value) return true;
  if (cookies.get('oauth_access_token')?.value) return true;

  const auth = request.headers.get('authorization');
  if (auth && /^Bearer\s+\S+/i.test(auth)) return true;

  return false;
}

// isSameOrigin guards this expensive LLM endpoint against cross-site callers
// (CSRF-style cost amplification). Browsers always attach an Origin header on
// cross-site fetch POSTs, so a *present* Origin that doesn't match this app's
// own host is rejected. We compare against the request's own host (derived
// from the Host header or, failing that, the request URL). When neither an
// Origin nor a Referer is present, we allow the request — non-browser callers
// that already passed the Bearer/cookie auth check above land here, and a
// malicious cross-site page can never suppress the Origin header.
function isSameOrigin(request: NextRequest): boolean {
  const expectedHost = request.headers.get('host') ?? request.nextUrl.host;

  const sourceHeader = request.headers.get('origin') ?? request.headers.get('referer');
  if (!sourceHeader) return true;

  if (!expectedHost) return false;

  try {
    return new URL(sourceHeader).host === expectedHost;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Auth (belt-and-suspenders — middleware also blocks this path).
  if (!hasAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 1b. Origin check — reject cross-site callers outright.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 2. Content-Type must be JSON.
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { error: 'Content-Type must be application/json' },
      { status: 415 },
    );
  }

  // 3. Reject oversized bodies before parsing.
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const tooLarge = parsed.error.issues.some((i) => i.message === 'image too large');
    if (tooLarge) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }
    return NextResponse.json(
      { error: 'imageBase64 and mimeType are required' },
      { status: 400 },
    );
  }

  const { imageBase64, mimeType } = parsed.data;

  if (!isSupportedMimeType(mimeType)) {
    return NextResponse.json(
      { error: 'Unsupported image type. Use jpeg, png, gif, or webp.' },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  let messageContent: string;
  try {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: 'You are analyzing a photo to help create a home service job posting. Extract: category (one of: cleaning, plumbing, electrical, hvac, landscaping, roofing, painting, flooring, carpentry, general), title (short, specific, ≤60 chars), description (2-3 sentences describing the work needed), budget_min_cents (integer), budget_max_cents (integer). Return JSON only.',
            },
          ],
        },
      ],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format from AI' }, { status: 502 });
    }
    messageContent = block.text;
  } catch {
    return NextResponse.json({ error: 'Failed to analyze image' }, { status: 502 });
  }

  // Strip markdown code fences if present
  const jsonText = messageContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonText);
  } catch {
    return NextResponse.json({ error: 'AI returned non-JSON response' }, { status: 400 });
  }

  const validated = claudeResponseSchema.safeParse(rawJson);
  if (!validated.success) {
    return NextResponse.json({ error: 'AI response missing required fields' }, { status: 400 });
  }

  const { category, title, description, budget_min_cents, budget_max_cents } = validated.data;

  return NextResponse.json({
    category,
    title,
    description,
    budgetMinCents: budget_min_cents,
    budgetMaxCents: budget_max_cents,
  });
}
