import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const requestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
});

const claudeResponseSchema = z.object({
  category: z.string(),
  title: z.string(),
  description: z.string(),
  budget_min_cents: z.number().int(),
  budget_max_cents: z.number().int(),
});

export async function POST(request: Request): Promise<NextResponse> {
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
    return NextResponse.json({ error: 'imageBase64 and mimeType are required' }, { status: 400 });
  }

  const { imageBase64, mimeType } = parsed.data;

  // Validate mime type is a supported image format
  const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
  type SupportedMimeType = (typeof supportedMimeTypes)[number];
  const isSupportedMimeType = (mime: string): mime is SupportedMimeType =>
    (supportedMimeTypes as readonly string[]).includes(mime);

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
      model: 'claude-haiku-4-5-20251001',
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
