'use client';

import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';

const PERMIT_CATEGORIES = new Set([
  'electrical',
  'plumbing',
  'hvac',
  'roofing',
  'structural',
  'addition',
  'demolition',
]);

const STORAGE_KEY_PREFIX = 'nm_permit_dismissed_';

interface PermitIntelligenceBannerProps {
  categorySlug: string;
}

export function PermitIntelligenceBanner({ categorySlug }: PermitIntelligenceBannerProps) {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid SSR flicker

  useEffect(() => {
    const key = STORAGE_KEY_PREFIX + categorySlug;
    const wasDismissed = localStorage.getItem(key) === '1';
    setDismissed(wasDismissed);
  }, [categorySlug]);

  if (!PERMIT_CATEGORIES.has(categorySlug)) {
    return null;
  }

  function handleDismiss() {
    const key = STORAGE_KEY_PREFIX + categorySlug;
    localStorage.setItem(key, '1');
    setDismissed(true);
  }

  if (dismissed) {
    return null;
  }

  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-bid-active/20 bg-bid-active/10 px-4 py-3 text-sm text-bid-active"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-bid-active" aria-hidden="true" />
      <p className="flex-1">
        This type of work typically requires a permit. Ask your provider to confirm permit status
        before work begins.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-1 hover:bg-bid-active/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-bid-active"
        aria-label="Dismiss permit information notice"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
