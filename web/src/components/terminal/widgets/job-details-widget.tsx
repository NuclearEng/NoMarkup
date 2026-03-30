'use client';

import { Badge } from '@/components/ui/badge';
import type { WidgetProps } from '../types';

export function JobDetailsWidget(_props: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <div className="border-b border-white/[0.06] -mx-4 -mt-4 mb-3 px-4 py-2.5 rounded-t-2xl">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Job Details
        </h3>
      </div>
      <p className="text-zinc-400 text-sm leading-relaxed">
        Complete kitchen renovation including cabinet replacement, countertop installation
        (quartz), backsplash tiling, new plumbing fixtures, electrical updates for
        under-cabinet lighting, and premium appliance installation. Kitchen is approximately
        180 sq ft with an L-shaped layout. Looking for experienced contractors with kitchen
        renovation expertise. All materials provided — labor only.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {['Kitchen', 'Renovation', 'Plumbing', 'Electrical', 'Tiling'].map((t) => (
          <Badge key={t} variant="secondary" className="border-zinc-700 bg-zinc-800/60 text-zinc-300 text-[10px]">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}
