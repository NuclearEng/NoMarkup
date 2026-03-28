'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface BidPriceChartProps {
  /** Array of bid amounts in cents, ordered by time */
  bids: number[];
  /** Height of the chart in pixels */
  height?: number;
  className?: string;
}

export function BidPriceChart({ bids, height = 120, className }: BidPriceChartProps) {
  const path = useMemo(() => {
    if (bids.length < 2) return '';
    const min = Math.min(...bids) * 0.95;
    const max = Math.max(...bids) * 1.05;
    const range = max - min || 1;
    const w = 100;
    const points = bids.map((v, i) => {
      const x = (i / (bids.length - 1)) * w;
      const y = height - ((v - min) / range) * (height - 16);
      return `${x},${y}`;
    });
    return `M${points.join(' L')}`;
  }, [bids, height]);

  const areaPath = useMemo(() => {
    if (!path) return '';
    return `${path} L100,${height} L0,${height} Z`;
  }, [path, height]);

  const isDown = bids.length >= 2 && bids[bids.length - 1]! < bids[0]!;

  if (bids.length < 2) {
    return (
      <div
        className={cn('text-muted-foreground flex items-center justify-center text-sm', className)}
        style={{ height }}
      >
        Waiting for bids...
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl', className)}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        style={{ height }}
        role="img"
        aria-label={`Bid price chart showing ${bids.length} bids, trending ${isDown ? 'down' : 'up'}`}
      >
        <defs>
          <linearGradient id="bid-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={isDown ? 'rgb(16,185,129)' : 'rgb(239,68,68)'}
              stopOpacity="0.2"
            />
            <stop
              offset="100%"
              stopColor={isDown ? 'rgb(16,185,129)' : 'rgb(239,68,68)'}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#bid-gradient)" />
        <path
          d={path}
          fill="none"
          stroke={isDown ? 'rgb(16,185,129)' : 'rgb(239,68,68)'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Price labels */}
      <div className="text-muted-foreground absolute top-1 left-2 text-[10px] font-medium">
        ${(Math.max(...bids) / 100).toFixed(0)}
      </div>
      <div className="text-muted-foreground absolute bottom-1 left-2 text-[10px] font-medium">
        ${(Math.min(...bids) / 100).toFixed(0)}
      </div>
    </div>
  );
}
