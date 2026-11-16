'use client';

import { Badge } from '@/components/ui/badge';
import type { WidgetProps } from '../types';

export function JobDetailsWidget({
  jobTitle,
  jobDescription,
  jobCategory,
}: WidgetProps) {
  const title = jobTitle?.trim() || null;
  const description = jobDescription?.trim() || null;
  const category = jobCategory?.trim() || null;

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <div className="border-b border-white/[0.06] -mx-4 -mt-4 mb-3 px-4 py-2.5 rounded-t-2xl">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Job Details
        </h3>
      </div>
      {title ? (
        <p className="mb-2 text-sm font-semibold text-zinc-100">{title}</p>
      ) : null}
      {description ? (
        <p className="text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
          {description}
        </p>
      ) : (
        <p className="text-sm text-zinc-500">No description provided for this job.</p>
      )}
      {category ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge
            variant="secondary"
            className="border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/10 text-[10px] text-[var(--brand-gold)]"
          >
            {category}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
