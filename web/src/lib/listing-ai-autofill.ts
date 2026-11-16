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

/**
 * Decide what the analysis may fill. Only empty fields are filled; anything
 * the seller already entered is kept. `applied` lists the fields that were
 * really filled, in display order, so the notice can say exactly that.
 */
export function planAiAutofill(
  current: AiAutofillCurrent,
  result: ListingImageAnalysisResult,
): { patch: AiAutofillPatch; applied: AiAutofillField[] } {
  const patch: AiAutofillPatch = {};
  const applied: AiAutofillField[] = [];

  if (!current.title.trim() && result.title.trim()) {
    patch.title = result.title.slice(0, TITLE_MAX);
    applied.push('title');
  }
  if (!current.description.trim() && result.description.trim()) {
    patch.description = result.description;
    applied.push('description');
  }
  // Categories are DB-driven, so any non-empty suggestion is a best-effort
  // prefill; the gateway validates it.
  if (!current.categoryId && result.categorySlug.trim()) {
    patch.categoryId = result.categorySlug;
    applied.push('category');
  }
  if (!current.startingPriceDollars) {
    patch.startingPriceDollars = Math.max(1, Math.round(result.suggestedStartingPriceCents / 100));
    applied.push('starting price');
  }
  return { patch, applied };
}

/** "a title", "a title and starting price", "a title, category, and starting price". */
export function describeAiAutofill(applied: readonly AiAutofillField[]): string {
  const [first, ...rest] = applied;
  if (first === undefined) return '';
  if (rest.length === 0) return `a ${first}`;
  if (rest.length === 1) return `a ${first} and ${rest[0] ?? ''}`;
  return `a ${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1] ?? ''}`;
}
