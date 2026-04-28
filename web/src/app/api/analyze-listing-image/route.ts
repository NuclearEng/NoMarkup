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

function hasAuth(request: NextRequest): boolean {
  const cookies = request.cookies;
  if (cookies.get('has_session')?.value === '1') return true;
  if (cookies.get('refresh_token')?.value) return true;
  if (cookies.get('oauth_access_token')?.value) return true;

  const auth = request.headers.get('authorization');
  if (auth && /^Bearer\s+\S+/i.test(auth)) return true;

  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Auth (belt-and-suspenders — middleware also blocks this path).
  if (!hasAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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
