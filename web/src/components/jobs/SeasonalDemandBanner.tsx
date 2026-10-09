'use client';

import { useEffect, useState } from 'react';
import { Zap, X } from 'lucide-react';

interface SeasonalRule {
  months: number[];
  message: string;
}

const SEASONAL_RULES = new Map<string, SeasonalRule>([
  [
    'hvac',
    {
      months: [5, 6, 7, 8],
      message: 'HVAC demand up 40% in summer — post before rates rise',
    },
  ],
  [
    'landscaping',
    {
      months: [3, 4, 5],
      message: 'Spring landscaping demand peaks in April',
    },
  ],
  [
    'roofing',
    {
      months: [3, 4, 8, 9],
      message: 'Roofing demand high — post now for best prices',
    },
  ],
  [
    'snow-removal',
    {
      months: [11, 12, 1, 2],
      message: 'Winter service demand up 60%',
    },
  ],
  [
    'painting',
    {
      months: [4, 5, 6, 9],
      message: 'Exterior painting season — book early',
    },
  ],
]);

const STORAGE_KEY_PREFIX = 'nm_seasonal_dismissed_';

interface SeasonalDemandBannerProps {
  categorySlug: string;
}

export function SeasonalDemandBanner({ categorySlug }: SeasonalDemandBannerProps) {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flicker on SSR

  useEffect(() => {
    const key = STORAGE_KEY_PREFIX + categorySlug;
    const wasDismissed = localStorage.getItem(key) === '1';
    setDismissed(wasDismissed);
  }, [categorySlug]);

  const rule = SEASONAL_RULES.get(categorySlug);
  const currentMonth = new Date().getMonth() + 1;
  const isActive = rule?.months.includes(currentMonth) ?? false;

  function handleDismiss() {
    const key = STORAGE_KEY_PREFIX + categorySlug;
    localStorage.setItem(key, '1');
    setDismissed(true);
  }

  if (!rule || !isActive || dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-trust-medium/20 bg-trust-medium/10 px-4 py-3 text-sm text-trust-medium"
    >
      <Zap className="h-4 w-4 shrink-0 text-trust-medium" aria-hidden="true" />
      <p className="flex-1">{rule.message}</p>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-1 hover:bg-trust-medium/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-trust-medium"
        aria-label="Dismiss seasonal demand notice"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
