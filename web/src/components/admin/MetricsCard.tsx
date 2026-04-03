'use client';

import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';

import { useCountUp } from '@/hooks/useCountUp';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface MetricsCardProps {
  label: string;
  value: string;
  numericValue?: number;
  description?: string;
  trend?: number;
  icon?: LucideIcon;
  loading?: boolean;
}

function AnimatedValue({ value, numericValue }: { value: string; numericValue?: number }) {
  const animated = useCountUp(numericValue ?? 0);
  if (numericValue === undefined) {
    return <span>{value}</span>;
  }
  // Preserve prefix (like $) and suffix by replacing the numeric portion
  const match = value.match(/^([^0-9]*)[\d,.]+(.*)/);
  if (!match) return <span>{value}</span>;
  return (
    <span>
      {match[1]}
      {animated.toLocaleString()}
      {match[2]}
    </span>
  );
}

export function MetricsCard({
  label,
  value,
  numericValue,
  description,
  trend,
  icon: Icon,
  loading = false,
}: MetricsCardProps) {
  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-zinc-400">{label}</CardTitle>
        {Icon ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.06]">
            <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton variant="price" className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold tabular-nums tracking-tight text-zinc-100">
            <AnimatedValue value={value} numericValue={numericValue} />
          </p>
        )}
        <div className="mt-1 flex items-center gap-2">
          {trend !== undefined && !loading ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                trend >= 0 ? 'text-emerald-400' : 'text-red-400',
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
            <span className="text-xs text-zinc-500">{description}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
