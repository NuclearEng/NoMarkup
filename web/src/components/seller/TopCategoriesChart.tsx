'use client';

// Wave 5 — top-categories list for the seller analytics dashboard.
// Renders the seller's 5 top-selling categories (by sold count in the
// window) as a horizontal-bar list, like Spotify's top-artists.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SellerAnalyticsTopCategory } from '@/types';

interface TopCategoriesChartProps {
  data: SellerAnalyticsTopCategory[];
  className?: string;
}

export function TopCategoriesChart({ data, className }: TopCategoriesChartProps) {
  const maxCount = Math.max(...data.map((c) => c.count), 1);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Top categories</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No category data yet. Sell something to populate this chart.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.map((cat) => {
              const widthPct = (cat.count / maxCount) * 100;
              return (
                <li key={cat.category_id}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="truncate font-medium">{cat.category_name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {cat.count} {cat.count === 1 ? 'sale' : 'sales'}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${String(widthPct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
