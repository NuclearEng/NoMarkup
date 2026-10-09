'use client';

// Inline banner shown at the top of a chat thread to explain that
// outbound messages route through the NoMarkup relay until the recipient
// replies. Closes audit Section F's "no privacy reassurance UX" gap.
//
// The banner is purely informational — no network calls. Render it
// unconditionally above the message thread.

import { ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

export function RelayBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-zinc-300',
        className,
      )}
      role="status"
      aria-label="Privacy notice"
    >
      <ShieldCheck
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand-gold)]"
        aria-hidden="true"
      />
      <p>
        <span className="font-medium text-foreground">
          Replies via NoMarkup relay
        </span>
        {' '}
        — your email and phone stay private until you reply.
      </p>
    </div>
  );
}
