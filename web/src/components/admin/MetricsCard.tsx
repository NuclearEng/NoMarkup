'use client';

import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MetricsCardProps {
  label: string;
  value: string;
  description?: string;
  trend?: number;
  icon?: LucideIcon;
  loading?: boolean;
}

export function MetricsCard({
  label,
  value,
  description,
  trend,
  icon: Icon,
  loading = false,
}: MetricsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        {Icon ? (
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          {trend !== undefined && !loading ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                trend >= 0 ? 'text-green-600' : 'text-red-600',
              )}
            >
              {trend >= 0 ? (
                <TrendingUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <TrendingDown className="h-3 w-3" aria-hidden="true" />
              )}
              {trend >= 0 ? '+' : ''}
              {trend.toFixed(1)}%
            </span>
          ) : null}
          {description ? (
            <span className="text-xs text-muted-foreground">{description}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
