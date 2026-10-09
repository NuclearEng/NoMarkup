import Anthropic from '@anthropic-ai/sdk';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { gateAiRoute } from '@/lib/server/ai-route-gate';

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

// Allowed category slugs — must stay in sync with the goods category list in
// `web/src/components/marketplace/ListingPostingForm.tsx`.
const ALLOWED_CATEGORY_SLUGS = [
  'goods-furniture',
  'goods-electronics',
  'goods-tools',
  'goods-sporting',
  'goods-vehicles',
  'goods-home-garden',
  'goods-books-media',
  'goods-collectibles',
  'goods-clothing',
  'goods-other',
] as const;

const ALLOWED_CONDITIONS = [
  'new',
  'like_new',
  'very_good',
  'good',
  'acceptable',
  'for_parts',
] as const;

const ALLOWED_CONFIDENCE = ['low', 'medium', 'high'] as const;

// Reasonable upper bound for a starting-bid price ($100k in cents).
const MAX_PRICE_CENTS = 100_000 * 100;

// `.strict()` rejects unknown fields — stops a client from smuggling in a
// `model` override or other unapproved parameters.
const requestSchema = z
  .object({
    imageBase64: z.string().min(1).max(MAX_BASE64_LEN, 'image too large'),
    mimeType: z.string().min(1),
  })
  .strict();

const claudeResponseSchema = z.object({
  category_slug: z.enum(ALLOWED_CATEGORY_SLUGS),
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  suggested_starting_price_cents: z.number().int().positive().max(MAX_PRICE_CENTS),
  condition: z.enum(ALLOWED_CONDITIONS),
  confidence: z.enum(ALLOWED_CONFIDENCE),
});

// isSameOrigin guards this expensive LLM endpoint against cross-site callers
// (CSRF-style cost amplification). Mirrors analyze-job-image (SEC-18).
// Browsers always attach an Origin header on cross-site fetch POSTs, so a
// *present* Origin that doesn't match this app's own host is rejected. We
// compare against the request's own host (derived from the Host header or,
// failing that, the request URL). When neither an Origin nor a Referer is
// present, we allow the request — non-browser callers that already passed
// the Bearer/cookie auth check above land here, and a malicious cross-site
// page can never suppress the Origin header.
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
  // 1. Auth + per-user rate limit. The middleware only checks for the
  // PRESENCE of a session indicator; this verifies the RS256 access JWT
  // (signature, exp, iss, aud) and enforces a sliding-window budget keyed by
  // the token's `sub` — this route spends real money per call.
  const gate = gateAiRoute(request);
  if (!gate.ok) {
    return gate.response;
  }

  // 1b. Origin check — reject cross-site callers outright (SEC-18).
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

  // AI photo analysis is an enhancement, not a requirement. When the provider
  // key is unset (common in dev), degrade gracefully with a clean 503 +
  // `aiUnavailable` flag instead of a 500 — the client treats this as a soft,
  // non-blocking notice so the seller can still fill the listing manually.
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return NextResponse.json(
      { aiUnavailable: true, error: 'AI photo analysis is not configured.' },
      { status: 503 },
    );
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

  const promptText = [
    'You are analyzing a photo for a peer-to-peer goods-marketplace listing (local pickup, ascending auction).',
    'Identify the item and produce auto-fill suggestions for the seller.',
    '',
    'Return ONLY a JSON object — no prose, no markdown — with these exact fields:',
    '- "category_slug": one of [goods-furniture, goods-electronics, goods-tools, goods-sporting, goods-vehicles, goods-home-garden, goods-books-media, goods-collectibles, goods-clothing, goods-other]',
    '- "title": ≤80 chars, focused on item identity (brand + model + condition cues), no exclamation marks',
    '- "description": 2-3 sentences covering visible condition, dimensions where evident, and accessories included',
    '- "suggested_starting_price_cents": integer cents, conservative starting bid — typically 30-50% of full retail',
    '- "condition": one of [new, like_new, very_good, good, acceptable, for_parts]',
    '- "confidence": one of [low, medium, high]',
    '',
    'If you cannot identify the item, choose category_slug "goods-other" and confidence "low".',
  ].join('\n');

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
              text: promptText,
            },
          ],
        },
      ],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      return NextResponse.json(
        { aiUnavailable: true, error: 'AI photo analysis is temporarily unavailable.' },
        { status: 503 },
      );
    }
    messageContent = block.text;
  } catch {
    // LLM call failed (network, rate limit, auth, provider outage). This is a
    // predictable condition for an optional enhancement — degrade to a clean
    // 503 rather than a 500 so the sell flow keeps working.
    return NextResponse.json(
      { aiUnavailable: true, error: 'AI photo analysis is temporarily unavailable.' },
      { status: 503 },
    );
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

  const {
    category_slug,
    title,
    description,
    suggested_starting_price_cents,
    condition,
    confidence,
  } = validated.data;

  return NextResponse.json({
    categorySlug: category_slug,
    title,
    description,
    suggestedStartingPriceCents: suggested_starting_price_cents,
    condition,
    confidence,
  });
}
