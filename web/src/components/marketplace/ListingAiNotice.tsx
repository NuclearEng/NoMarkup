import { Info, Sparkles } from 'lucide-react';

import { MonoPrice } from '@/components/ui/mono-price';
import { Skeleton } from '@/components/ui/skeleton';
import { describeAiAutofill, type AiAutofillField } from '@/lib/listing-ai-autofill';
import { cn } from '@/lib/utils';

export type ListingAiState = 'idle' | 'analyzing' | 'applied' | 'unavailable' | 'error';

interface ListingAiNoticeProps {
  state: ListingAiState;
  /** Fields the analysis really filled; the notice names only these. */
  applied: readonly AiAutofillField[];
  /** Suggested starting price, shown when the price was one of the filled fields. */
  suggestedPriceCents?: number;
  className?: string;
}

const GOLD_BOX = 'rounded-md border border-brand-gold/30 bg-brand-gold/5 p-3 text-sm text-zinc-200';

/**
 * Status of the photo analysis on the Sell wizard: running, what it filled, or
 * a soft "fill it in yourself" note. Always non-blocking.
 */
export function ListingAiNotice({
  state,
  applied,
  suggestedPriceCents = 0,
  className,
}: ListingAiNoticeProps) {
  if (state === 'idle') return null;

  if (state === 'analyzing') {
    return (
      <div role="status" aria-live="polite" className={cn('space-y-2', GOLD_BOX, className)}>
        <div className="flex items-start gap-2">
          <Sparkles
            className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-brand-gold"
            aria-hidden="true"
          />
          <span>
            Analyzing your first photo to suggest a category, title, description, and starting
            price… You can keep going: suggestions only fill what you leave empty.
          </span>
        </div>
        <div className="space-y-2 pl-6">
          <Skeleton className="h-3 w-3/4" variant="text" />
          <Skeleton className="h-3 w-1/2" variant="text" />
          <Skeleton className="h-5 w-24" variant="price" />
        </div>
      </div>
    );
  }

  if (state === 'applied') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('flex items-start gap-2', GOLD_BOX, className)}
      >
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" aria-hidden="true" />
        <span data-testid="ai-autofill-notice">
          {applied.length > 0
            ? `AI filled in ${describeAiAutofill(applied)} from your first photo`
            : 'AI filled in nothing: your own entries were kept'}
          {applied.includes('starting price') && suggestedPriceCents > 0 ? (
            <>
              {' '}
              (
              <MonoPrice cents={suggestedPriceCents} className="font-semibold text-zinc-100" />)
            </>
          ) : null}
          {applied.length > 0
            ? '. Each one is marked “AI suggested” on its step — edit anything before publishing.'
            : '.'}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-300',
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
      <span>
        Couldn&apos;t auto-analyze the photo — no problem, just fill in the category, title,
        description, and starting price yourself on the next steps.
      </span>
    </div>
  );
}
