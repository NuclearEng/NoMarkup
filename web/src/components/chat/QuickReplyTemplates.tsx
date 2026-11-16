'use client';

// Horizontal scrollable rail of quick-reply chips. Closes audit Section F.
//
// Source order:
//   1. The user's own templates (sorted by use_count DESC, recent first).
//   2. The built-in default list returned by the gateway.
//
// Selecting a chip calls onSelect with the body so the parent can insert
// it into the message input. We bump use_count for stored templates only
// (default rows have no ID, so /use is skipped).

import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useChatTemplates, useUseChatTemplate } from '@/hooks/useChatTemplates';
import { cn } from '@/lib/utils';

interface QuickReplyTemplatesProps {
  /** Insert the selected template into the message input. */
  onSelect: (body: string) => void;
  className?: string;
}

export function QuickReplyTemplates({
  onSelect,
  className,
}: QuickReplyTemplatesProps) {
  const { data, isLoading } = useChatTemplates();
  const useTemplate = useUseChatTemplate();

  if (isLoading) {
    return null;
  }

  const userTemplates = data?.templates ?? [];
  const defaults = data?.defaults ?? [];
  const hasUserTemplates = userTemplates.length > 0;
  const hasAny = hasUserTemplates || defaults.length > 0;

  if (!hasAny) {
    return null;
  }

  function handleSelectStored(id: string, body: string) {
    onSelect(body);
    // Fire-and-forget — failure to bump use_count must not block the
    // composer. TanStack invalidation reorders the rail on the next
    // open.
    useTemplate.mutate(id);
  }

  return (
    <div
      className={cn(
        'border-t border-white/[0.06] bg-white/[0.01] px-3 py-2',
        className,
      )}
      aria-label="Quick reply templates"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        Quick replies
      </div>
      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="listbox"
        aria-label="Quick reply suggestions"
      >
        {userTemplates.map((tpl) => (
          <Button
            key={tpl.id}
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap text-xs"
            onClick={() => {
              handleSelectStored(tpl.id, tpl.body);
            }}
            role="option"
            aria-label={`Insert: ${tpl.body}`}
          >
            {tpl.body}
          </Button>
        ))}
        {defaults.map((body, i) => (
          <Button
            key={`default-${String(i)}`}
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
            onClick={() => {
              onSelect(body);
            }}
            role="option"
            aria-label={`Insert: ${body}`}
          >
            {body}
          </Button>
        ))}
      </div>
    </div>
  );
}
