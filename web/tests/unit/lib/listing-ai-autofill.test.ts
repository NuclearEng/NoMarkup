// What the photo analysis may fill on the Sell form, and what the notice says
// about it. Photos are the first wizard step, so in the normal flow every
// field is still empty when the analysis returns; a seller who moves ahead
// and types before it does keeps what they typed.
import { describe, expect, it } from 'vitest';

import { describeAiAutofill, findCategoryBySlug, planAiAutofill } from '@/lib/listing-ai-autofill';
import type { ListingImageAnalysisResult } from '@/types';

const ANALYSIS: ListingImageAnalysisResult = {
  categorySlug: 'goods-electronics',
  title: 'Vintage receiver',
  description: 'A well kept stereo receiver from the seventies.',
  suggestedStartingPriceCents: 4500,
  condition: 'good',
  confidence: 'high',
};

const CATEGORY = { id: 'cat-electronics', name: 'Electronics' };

const FILLED = {
  title: 'My receiver',
  description: 'Works well, some scratches on the case.',
  categoryId: 'cat-1',
  startingPriceDollars: undefined,
};

describe('planAiAutofill', () => {
  it('fills only the starting price when the seller entered everything else first', () => {
    const { patch, applied } = planAiAutofill(FILLED, ANALYSIS, CATEGORY);
    expect(patch).toEqual({ startingPriceDollars: 45 });
    expect(applied).toEqual(['starting price']);
  });

  it('fills nothing when the seller has entered everything', () => {
    const { patch, applied } = planAiAutofill({ ...FILLED, startingPriceDollars: 80 }, ANALYSIS);
    expect(patch).toEqual({});
    expect(applied).toEqual([]);
  });

  it('fills every empty field and lists them in wizard order', () => {
    const { patch, applied } = planAiAutofill(
      { title: '  ', description: '', categoryId: '', startingPriceDollars: 0 },
      ANALYSIS,
      CATEGORY,
    );
    expect(patch).toEqual({
      title: 'Vintage receiver',
      description: ANALYSIS.description,
      categoryId: 'cat-electronics',
      startingPriceDollars: 45,
    });
    expect(applied).toEqual(['category', 'title', 'description', 'starting price']);
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

  it('does not fill a category whose slug did not resolve to a known category', () => {
    const { patch, applied } = planAiAutofill(
      { title: '', description: '', categoryId: '', startingPriceDollars: 0 },
      ANALYSIS,
      undefined,
    );
    expect(patch.categoryId).toBeUndefined();
    expect(applied).toEqual(['title', 'description', 'starting price']);
  });

  it('keeps the category the seller already picked', () => {
    const { patch, applied } = planAiAutofill(
      { title: '', description: '', categoryId: 'cat-mine', startingPriceDollars: 0 },
      ANALYSIS,
      CATEGORY,
    );
    expect(patch.categoryId).toBeUndefined();
    expect(applied).not.toContain('category');
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
    [['category', 'title', 'starting price'], 'a category, title, and starting price'],
    [
      ['category', 'title', 'description', 'starting price'],
      'a category, title, description, and starting price',
    ],
  ] as const)('%j → %s', (applied, text) => {
    expect(describeAiAutofill(applied)).toBe(text);
  });
});

describe('findCategoryBySlug', () => {
  interface Node {
    slug: string;
    children?: Node[];
  }
  const TREE: Node[] = [
    { slug: 'goods-furniture', children: [] },
    { slug: 'goods-electronics', children: [{ slug: 'goods-electronics-audio' }] },
  ];

  it('finds a top-level category', () => {
    expect(findCategoryBySlug(TREE, 'goods-furniture')).toBe(TREE[0]);
  });

  it('finds a nested category', () => {
    expect(findCategoryBySlug(TREE, 'goods-electronics-audio')?.slug).toBe(
      'goods-electronics-audio',
    );
  });

  it('returns undefined for an unknown slug, an empty slug, or a tree that has not loaded', () => {
    expect(findCategoryBySlug(TREE, 'goods-spaceships')).toBeUndefined();
    expect(findCategoryBySlug(TREE, '')).toBeUndefined();
    expect(findCategoryBySlug(undefined, 'goods-furniture')).toBeUndefined();
  });
});
