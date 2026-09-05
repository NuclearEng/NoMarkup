'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface DepthBucket {
  amount_cents: number;
  count: number;
}

interface BidDepthChartProps {
  bids: DepthBucket[];
  startingPrice: number;
  currentLowest: number;
  className?: string;
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function BidDepthChart({
  bids,
  startingPrice,
  currentLowest,
  className,
}: BidDepthChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const [mounted, setMounted] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    price: number;
    cumulativeCount: number;
  } | null>(null);

  const height = 180;
  const padding = useMemo(() => ({ top: 16, right: 16, bottom: 28, left: 16 }), []);

  // Responsive width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Mount animation trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Sort by price ascending and compute cumulative counts
  const cumulativeData = useMemo(() => {
    if (bids.length === 0) return [];

    const sorted = [...bids].sort((a, b) => a.amount_cents - b.amount_cents);
    let cumulative = 0;
    return sorted.map((bucket) => {
      cumulative += bucket.count;
      return {
        amount_cents: bucket.amount_cents,
        count: bucket.count,
        cumulative,
      };
    });
  }, [bids]);

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale helpers
  const priceMin = cumulativeData.length > 0
    ? (cumulativeData[0] as (typeof cumulativeData)[0]).amount_cents
    : 0;
  const priceMax = Math.max(
    startingPrice,
    cumulativeData.length > 0
      ? (cumulativeData[cumulativeData.length - 1] as (typeof cumulativeData)[0]).amount_cents
      : startingPrice,
  );
  const priceRange = priceMax - priceMin || 1;
  const countMax = cumulativeData.length > 0
    ? (cumulativeData[cumulativeData.length - 1] as (typeof cumulativeData)[0]).cumulative
    : 1;

  const scaleX = useCallback(
    (price: number) => padding.left + ((price - priceMin) / priceRange) * chartWidth,
    [padding.left, priceMin, priceRange, chartWidth],
  );
  const scaleY = useCallback(
    (count: number) => padding.top + chartHeight - (count / countMax) * chartHeight,
    [padding.top, chartHeight, countMax],
  );

  // Build area path
  const areaPath = useMemo(() => {
    if (cumulativeData.length === 0) return '';

    const points = cumulativeData.map((d) => ({
      x: scaleX(d.amount_cents),
      y: scaleY(d.cumulative),
    }));

    // Start from bottom-left
    let path = `M ${String(padding.left)} ${String(padding.top + chartHeight)}`;

    // Step up to first point
    const firstPoint = points[0];
    if (firstPoint) {
      path += ` L ${String(firstPoint.x)} ${String(padding.top + chartHeight)}`;
      path += ` L ${String(firstPoint.x)} ${String(firstPoint.y)}`;
    }

    // Step through each point (staircase / step function)
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (prev && curr) {
        // Horizontal to new x, then vertical to new y
        path += ` L ${String(curr.x)} ${String(prev.y)}`;
        path += ` L ${String(curr.x)} ${String(curr.y)}`;
      }
    }

    // Extend to right edge and close
    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      path += ` L ${String(padding.left + chartWidth)} ${String(lastPoint.y)}`;
    }
    path += ` L ${String(padding.left + chartWidth)} ${String(padding.top + chartHeight)}`;
    path += ' Z';

    return path;
  }, [cumulativeData, scaleX, scaleY, padding, chartWidth, chartHeight]);

  // Line path (top edge of the area)
  const linePath = useMemo(() => {
    if (cumulativeData.length === 0) return '';

    const points = cumulativeData.map((d) => ({
      x: scaleX(d.amount_cents),
      y: scaleY(d.cumulative),
    }));

    const firstPoint = points[0];
    if (!firstPoint) return '';

    let path = `M ${String(firstPoint.x)} ${String(firstPoint.y)}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (prev && curr) {
        path += ` L ${String(curr.x)} ${String(prev.y)}`;
        path += ` L ${String(curr.x)} ${String(curr.y)}`;
      }
    }

    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      path += ` L ${String(padding.left + chartWidth)} ${String(lastPoint.y)}`;
    }

    return path;
  }, [cumulativeData, scaleX, scaleY, padding.left, chartWidth]);

  // Current lowest marker
  const lowestX = scaleX(currentLowest);

  // Handle mouse move for tooltip
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (cumulativeData.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      // Find closest data point
      const mousePrice = priceMin + ((mouseX - padding.left) / chartWidth) * priceRange;
      let closest = cumulativeData[0];
      if (!closest) return;

      for (const d of cumulativeData) {
        if (Math.abs(d.amount_cents - mousePrice) < Math.abs(closest.amount_cents - mousePrice)) {
          closest = d;
        }
      }

      setHoverInfo({
        x: scaleX(closest.amount_cents),
        y: scaleY(closest.cumulative),
        price: closest.amount_cents,
        cumulativeCount: closest.cumulative,
      });
    },
    [cumulativeData, priceMin, priceRange, padding.left, chartWidth, scaleX, scaleY],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  // X-axis labels (3-4 price ticks)
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = priceRange / 3;
    for (let i = 0; i <= 3; i++) {
      ticks.push(priceMin + step * i);
    }
    return ticks;
  }, [priceMin, priceRange]);

  if (cumulativeData.length === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'flex h-[180px] items-center justify-center rounded-xl border border-border/50 bg-card',
          className,
        )}
        role="img"
        aria-label="Bid depth chart — no bids yet"
      >
        <p className="text-xs text-muted-foreground">Depth chart will appear when bids are placed</p>
      </div>
    );
  }

  const chartSeed = String(Math.abs(startingPrice) % 10000);
  const gradientId = `depthGradient-${chartSeed}`;
  const maskId = `depthMask-${chartSeed}`;

  return (
    <div ref={containerRef} className={cn('w-full', className)}>
      <style>{`
        @keyframes depthFillIn {
          from { clip-path: inset(100% 0 0 0); }
          to { clip-path: inset(0 0 0 0); }
        }
      `}</style>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={`Bid depth chart showing cumulative bid distribution. ${String(cumulativeData.length)} price levels, lowest at ${formatPrice(currentLowest)}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="cursor-crosshair"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--brand-green)" stopOpacity="0.35" />
            <stop offset="50%" stopColor="var(--brand-green)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--brand-green)" stopOpacity="0.04" />
          </linearGradient>
          <clipPath id={maskId}>
            <rect
              x={padding.left}
              y={padding.top}
              width={chartWidth}
              height={chartHeight}
            />
          </clipPath>
        </defs>

        {/* Area fill with animation */}
        <g clipPath={`url(#${maskId})`}>
          <path
            d={areaPath}
            fill={`url(#${gradientId})`}
            style={{
              animation: mounted ? 'depthFillIn 0.8s ease-out forwards' : 'none',
              clipPath: mounted ? 'inset(0 0 0 0)' : 'inset(100% 0 0 0)',
            }}
          />

          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--brand-green)"
            strokeWidth={2}
            opacity={mounted ? 1 : 0}
            style={{ transition: 'opacity 0.5s ease-out 0.3s' }}
          />

          {/* Glow line */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--brand-green)"
            strokeWidth={6}
            opacity={mounted ? 0.1 : 0}
            style={{ transition: 'opacity 0.5s ease-out 0.3s' }}
          />
        </g>

        {/* Current lowest marker */}
        {currentLowest > 0 && (
          <g
            opacity={mounted ? 1 : 0}
            style={{ transition: 'opacity 0.5s ease-out 0.5s' }}
          >
            <line
              x1={lowestX}
              y1={padding.top}
              x2={lowestX}
              y2={padding.top + chartHeight}
              stroke="hsl(var(--trust-medium))"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              opacity={0.6}
            />
            <text
              x={lowestX}
              y={padding.top - 4}
              textAnchor="middle"
              className="fill-trust-medium text-[9px] font-bold"
            >
              {formatPrice(currentLowest)}
            </text>
          </g>
        )}

        {/* X-axis ticks */}
        {xTicks.map((price) => {
          const x = scaleX(price);
          return (
            <text
              key={String(price)}
              x={x}
              y={height - 4}
              textAnchor="middle"
              className="fill-muted-foreground/40 text-[9px]"
            >
              {formatPrice(price)}
            </text>
          );
        })}

        {/* Hover tooltip */}
        {hoverInfo !== null && (
          <g>
            <line
              x1={hoverInfo.x}
              y1={padding.top}
              x2={hoverInfo.x}
              y2={padding.top + chartHeight}
              stroke="currentColor"
              className="text-muted-foreground/30"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={hoverInfo.x}
              cy={hoverInfo.y}
              r={4}
              fill="var(--brand-green)"
              stroke="var(--background)"
              strokeWidth={2}
            />
            {/* Tooltip background */}
            <rect
              x={hoverInfo.x - 48}
              y={hoverInfo.y - 32}
              width={96}
              height={24}
              rx={4}
              fill="color-mix(in srgb, var(--background) 90%, transparent)"
              stroke="color-mix(in srgb, var(--brand-green) 30%, transparent)"
              strokeWidth={1}
            />
            <text
              x={hoverInfo.x}
              y={hoverInfo.y - 16}
              textAnchor="middle"
              className="text-[10px] font-medium"
              fill="var(--brand-green)"
            >
              {formatPrice(hoverInfo.price)} ({String(hoverInfo.cumulativeCount)} bid{hoverInfo.cumulativeCount !== 1 ? 's' : ''})
            </text>
          </g>
        )}

        {/* Data points */}
        {cumulativeData.map((d, i) => (
          <circle
            key={`${String(d.amount_cents)}-${String(i)}`}
            cx={scaleX(d.amount_cents)}
            cy={scaleY(d.cumulative)}
            r={3}
            fill="var(--brand-green)"
            stroke="var(--background)"
            strokeWidth={1.5}
            opacity={mounted ? 0.8 : 0}
            style={{ transition: `opacity 0.3s ease-out ${String(0.5 + i * 0.05)}s` }}
          >
            <title>{`${formatPrice(d.amount_cents)}: ${String(d.cumulative)} cumulative bid${d.cumulative !== 1 ? 's' : ''}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

