'use client';

import { useState } from 'react';

import { formatCents } from '@/lib/utils';

interface ShareSavingsCardProps {
  savingsCents: number;
  jobTitle: string;
  category: string;
}

export function ShareSavingsCard({ savingsCents, jobTitle, category }: ShareSavingsCardProps) {
  const [copied, setCopied] = useState(false);

  const shareText = `I just saved ${formatCents(savingsCents)} on ${category} with NoMarkup!`;
  const shareUrl = 'https://nomarkup.com';

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard API not available (HTTP, iframe, etc.)
    }
  }

  function handleShareTwitter() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
  }

  function handleShareFacebook() {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'width=600,height=400');
  }

  return (
    <div className="rounded-xl border bg-gradient-to-br from-emerald-50 to-emerald-100 p-6 dark:from-emerald-950/20 dark:to-emerald-900/20">
      {/* Card preview */}
      <div className="mb-4 text-center">
        <div className="text-muted-foreground mb-1 text-sm">I saved</div>
        <div className="text-4xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
          {formatCents(savingsCents)}
        </div>
        <div className="text-muted-foreground mt-1 text-sm">
          on {category} with NoMarkup
        </div>
        <div className="text-muted-foreground/60 mt-0.5 text-xs">{jobTitle}</div>
      </div>

      {/* Share buttons */}
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={handleShareTwitter}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          Share on X
        </button>
        <button
          onClick={handleShareFacebook}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Share on Facebook
        </button>
        <button
          onClick={handleCopyLink}
          className="hover:bg-accent inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium"
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      </div>
    </div>
  );
}
