import type { PricingOverviewCategory } from '@/hooks/usePricing';

/**
 * Row shape for the landing MarketTickerStrip marquee.
 * Shared between the RSC seed path and the client island.
 */
export interface TickerItem {
  category: string;
  location: string;
  currentPrice: number;
  originalPrice?: number;
  bidCount?: number;
  timeRemaining?: string;
  status: 'active' | 'completed' | 'ending-soon';
}

/** Map Fair Price Index categories → marquee ticker rows (server + client). */
export function pricingCategoriesToTickerItems(
  categories: readonly PricingOverviewCategory[],
): TickerItem[] {
  return categories
    .filter((c) => c.total_jobs > 0 && c.avg_median_cents > 0)
    .map((c): TickerItem => {
      const hasSavings = c.avg_savings_cents != null && c.avg_savings_cents > 0;
      return {
        category: c.category_name,
        location: `${String(c.total_jobs)} jobs`,
        currentPrice: c.avg_median_cents,
        ...(hasSavings && c.avg_savings_cents != null
          ? { originalPrice: c.avg_median_cents + c.avg_savings_cents }
          : {}),
        status: hasSavings ? ('completed' as const) : ('active' as const),
      };
    });
}
