import type { ListingImageAnalysisResult } from '@/types';

/** A form field the photo analysis can prefill. */
export type AiAutofillField = 'title' | 'description' | 'category' | 'starting price';

/** The form values the auto-fill looks at. */
export interface AiAutofillCurrent {
  title: string;
  description: string;
  categoryId: string;
  startingPriceDollars: number | undefined;
}

/** Values to write into the form; a key is present only when it is filled. */
export interface AiAutofillPatch {
  title?: string;
  description?: string;
  categoryId?: string;
  startingPriceDollars?: number;
}

const TITLE_MAX = 120;

/** A goods category the analysis' slug resolved to. */
export interface AiAutofillCategory {
  id: string;
  name: string;
}

/**
 * Decide what the analysis may fill. Only empty fields are filled; anything
 * the seller already entered is kept. `applied` lists the fields that were
 * really filled, in wizard order, so the notice can say exactly that.
 *
 * `category` is the goods category the suggested slug resolved to in the
 * loaded category tree. The form stores category ids and the picker can only
 * show an id it knows, so an unresolved slug is not filled.
 */
export function planAiAutofill(
  current: AiAutofillCurrent,
  result: ListingImageAnalysisResult,
  category?: AiAutofillCategory,
): { patch: AiAutofillPatch; applied: AiAutofillField[] } {
  const patch: AiAutofillPatch = {};
  const applied: AiAutofillField[] = [];

  if (!current.categoryId && category) {
    patch.categoryId = category.id;
    applied.push('category');
  }
  if (!current.title.trim() && result.title.trim()) {
    patch.title = result.title.slice(0, TITLE_MAX);
    applied.push('title');
  }
  if (!current.description.trim() && result.description.trim()) {
    patch.description = result.description;
    applied.push('description');
  }
  if (!current.startingPriceDollars) {
    patch.startingPriceDollars = Math.max(1, Math.round(result.suggestedStartingPriceCents / 100));
    applied.push('starting price');
  }
  return { patch, applied };
}

/** Find a category by slug anywhere in a category tree. */
export function findCategoryBySlug<T extends { slug: string; children?: T[] }>(
  tree: readonly T[] | undefined,
  slug: string,
): T | undefined {
  if (!tree || !slug) return undefined;
  for (const node of tree) {
    if (node.slug === slug) return node;
    const nested = findCategoryBySlug(node.children, slug);
    if (nested) return nested;
  }
  return undefined;
}

/** "a title", "a title and starting price", "a category, title, and starting price". */
export function describeAiAutofill(applied: readonly AiAutofillField[]): string {
  const [first, ...rest] = applied;
  if (first === undefined) return '';
  if (rest.length === 0) return `a ${first}`;
  if (rest.length === 1) return `a ${first} and ${rest[0] ?? ''}`;
  return `a ${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1] ?? ''}`;
}
