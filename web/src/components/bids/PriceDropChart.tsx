'use client';

import { useMemo, useRef, useEffect, useState } from 'react';

import type { AuctionBidEvent } from '@/types';

interface PriceDropChartProps {
  events: AuctionBidEvent[];
}

export function PriceDropChart({ events }: PriceDropChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const height = 200;
  const padding = { top: 20, right: 60, bottom: 30, left: 10 };

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

  // Filter to only bid_placed and bid_updated (price-changing events)
  const priceEvents = useMemo(
    () => events.filter((e) => e.event_type === 'bid_placed' || e.event_type === 'bid_updated'),
    [events],
  );

  // Compute running minimum for step chart
  const steps = useMemo(() => {
    if (priceEvents.length === 0) return [];

    const first = priceEvents[0];
    if (!first) return [];
    let runningMin = first.amount_cents;
    return priceEvents.map((e) => {
      runningMin = Math.min(runningMin, e.amount_cents);
      return {
        time: new Date(e.created_at).getTime(),
        price: runningMin,
        amount: e.amount_cents,
      };
    });
  }, [priceEvents]);

  if (steps.length === 0 || width === 0) {
    return (
      <div
        ref={containerRef}
        className="text-muted-foreground flex h-[200px] items-center justify-center text-sm"
        role="img"
        aria-label="Price history chart — no bids yet"
      >
        No bids yet — prices will appear here as providers compete.
      </div>
    );
  }

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Safe: we return early above when steps.length === 0
  const firstStep = steps[0] as (typeof steps)[0];
  const lastStep = steps[steps.length - 1] as (typeof steps)[0];

  const timeMin = firstStep.time;
  const timeMax = lastStep.time;
  const timeRange = timeMax - timeMin || 1;

  const priceMin = Math.min(...steps.map((s) => s.price));
  const priceMax = Math.max(...steps.map((s) => s.price));
  // Use proportional padding, with a minimum of 5% of the max price
  const pricePad = Math.max((priceMax - priceMin) * 0.2, priceMax * 0.05, 500);
  const yMin = priceMin - pricePad;
  const yMax = priceMax + pricePad;

  const scaleX = (time: number) => padding.left + ((time - timeMin) / timeRange) * chartWidth;
  const scaleY = (price: number) => padding.top + ((yMax - price) / (yMax - yMin)) * chartHeight;

  // Build step path
  const pathParts: string[] = [];
  steps.forEach((step, i) => {
    const x = scaleX(step.time);
    const y = scaleY(step.price);
    if (i === 0) {
      pathParts.push(`M ${String(x)} ${String(y)}`);
    } else {
      // Horizontal line to new x, then vertical drop
      pathParts.push(`H ${String(x)}`);
      pathParts.push(`V ${String(y)}`);
    }
  });
  // Extend to right edge
  pathParts.push(`H ${String(width - padding.right)}`);
  const pathD = pathParts.join(' ');

  const formatPrice = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div ref={containerRef} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={`Price history chart showing ${String(steps.length)} price changes. Current lowest: ${formatPrice(lastStep.price)}`}
      >
        {/* Grid lines — skip labels that overlap with current price */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = padding.top + frac * chartHeight;
          const price = yMax - frac * (yMax - yMin);
          const currentPriceY = scaleY(lastStep.price);
          const tooClose = Math.abs(y - currentPriceY) < 14;
          return (
            <g key={String(frac)}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="currentColor"
                className="text-border"
                strokeDasharray="4 4"
                opacity={0.3}
              />
              {!tooClose ? (
                <text
                  x={width - padding.right + 4}
                  y={y + 4}
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatPrice(price)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Step line */}
        <path d={pathD} fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round" />

        {/* Drop points */}
        {steps.map((step, i) => (
          <circle
            key={`${String(step.time)}-${String(i)}`}
            cx={scaleX(step.time)}
            cy={scaleY(step.price)}
            r={4}
            fill="#22c55e"
            stroke="white"
            strokeWidth={2}
          >
            <title>{`${formatPrice(step.amount)} at ${new Date(step.time).toLocaleTimeString()}`}</title>
          </circle>
        ))}

        {/* Current price label */}
        <text
          x={width - padding.right + 4}
          y={scaleY(lastStep.price) + 4}
          className="fill-green-600 text-xs font-bold"
        >
          {formatPrice(lastStep.price)}
        </text>
      </svg>
    </div>
  );
}
