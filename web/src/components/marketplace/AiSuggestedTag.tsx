import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

interface AiSuggestedTagProps {
  className?: string;
}

/**
 * Marks a form field whose current value came from the photo analysis and has
 * not been edited by the seller. Text plus icon, never colour alone.
 */
export function AiSuggestedTag({ className }: AiSuggestedTagProps) {
  return (
    <span
      data-testid="ai-suggested-tag"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-brand-gold/30 bg-brand-gold/10 px-1.5 py-0.5 text-xs font-medium text-brand-gold-bright',
        className,
      )}
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      AI suggested
    </span>
  );
}
