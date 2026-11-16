// What the photo analysis may fill on the Sell form, and what the notice says
// about it. The wizard runs the analysis at the Photos step, after category,
// title and description have been validated, so in the normal flow only the
// starting price is open. The notice used to claim "a title, category, and
// starting price" regardless.
import { describe, expect, it } from 'vitest';

import { describeAiAutofill, planAiAutofill } from '@/lib/listing-ai-autofill';
import type { ListingImageAnalysisResult } from '@/types';

const ANALYSIS: ListingImageAnalysisResult = {
  categorySlug: 'electronics',
  title: 'Vintage receiver',
  description: 'A well kept stereo receiver from the seventies.',
  suggestedStartingPriceCents: 4500,
  condition: 'good',
  confidence: 'high',
};

const FILLED = {
  title: 'My receiver',
  description: 'Works well, some scratches on the case.',
  categoryId: 'cat-1',
  startingPriceDollars: undefined,
};

describe('planAiAutofill', () => {
  it('at the Photos step fills only the starting price and reports only that', () => {
    const { patch, applied } = planAiAutofill(FILLED, ANALYSIS);
    expect(patch).toEqual({ startingPriceDollars: 45 });
    expect(applied).toEqual(['starting price']);
  });

  it('fills nothing when the seller has entered everything', () => {
    const { patch, applied } = planAiAutofill({ ...FILLED, startingPriceDollars: 80 }, ANALYSIS);
    expect(patch).toEqual({});
    expect(applied).toEqual([]);
  });

  it('fills every empty field and lists them in display order', () => {
    const { patch, applied } = planAiAutofill(
      { title: '  ', description: '', categoryId: '', startingPriceDollars: 0 },
      ANALYSIS,
    );
    expect(patch).toEqual({
      title: 'Vintage receiver',
      description: ANALYSIS.description,
      categoryId: 'electronics',
      startingPriceDollars: 45,
    });
    expect(applied).toEqual(['title', 'description', 'category', 'starting price']);
  });

  it('caps a suggested title at 120 characters', () => {
    const { patch } = planAiAutofill(
      { ...FILLED, title: '' },
      { ...ANALYSIS, title: 'T'.repeat(150) },
    );
    expect(patch.title).toBe('T'.repeat(120));
  });

  it('does not report a category or title the analysis left blank', () => {
    const { applied } = planAiAutofill(
      { title: '', description: 'kept', categoryId: '', startingPriceDollars: 10 },
      { ...ANALYSIS, title: ' ', categorySlug: '' },
    );
    expect(applied).toEqual([]);
  });

  it('suggests at least $1 when the model returns 0', () => {
    const { patch } = planAiAutofill(FILLED, { ...ANALYSIS, suggestedStartingPriceCents: 0 });
    expect(patch.startingPriceDollars).toBe(1);
  });
});

describe('describeAiAutofill', () => {
  it.each([
    [[], ''],
    [['starting price'], 'a starting price'],
    [['title', 'starting price'], 'a title and starting price'],
    [['title', 'category', 'starting price'], 'a title, category, and starting price'],
    [
      ['title', 'description', 'category', 'starting price'],
      'a title, description, category, and starting price',
    ],
  ] as const)('%j → %s', (applied, text) => {
    expect(describeAiAutofill(applied)).toBe(text);
  });
});
