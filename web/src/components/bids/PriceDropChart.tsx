'use client';

import { useMemo, useRef, useEffect, useState } from 'react';

import type { AuctionBidEvent } from '@/types';

interface PriceDropChartProps {
  events: AuctionBidEvent[];
}

export function PriceDropChart({ events }: PriceDropChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const [mounted, setMounted] = useState(false);
  const height = 220;
  const padding = { top: 24, right: 64, bottom: 32, left: 10 };

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

  // Trigger mount animation
  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
    }, 100);
    return () => {
      clearTimeout(timer);
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

  // Compute significant drops (> 5% of previous price)
  const significantDrops = useMemo(() => {
    if (steps.length < 2) return [];
    const drops: Array<{ index: number; dropCents: number }> = [];
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const curr = steps[i];
      if (prev && curr && curr.price < prev.price) {
        const dropPercent = (prev.price - curr.price) / prev.price;
        if (dropPercent > 0.05) {
          drops.push({ index: i, dropCents: prev.price - curr.price });
        }
      }
    }
    return drops;
  }, [steps]);

  if (steps.length === 0 || width === 0) {
    return (
      <div
        ref={containerRef}
        className="flex h-[220px] items-center justify-center text-sm text-muted-foreground"
        role="img"
        aria-label="Price history chart — no bids yet"
      >
        <div className="text-center">
          <p className="text-base font-medium text-muted-foreground/70">Waiting for bids</p>
          <p className="mt-1 text-xs text-muted-foreground/50">
            Prices will appear here as providers compete
          </p>
        </div>
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

  // Build fill path (closed area under the step line)
  const fillPathD =
    pathD +
    ` V ${String(padding.top + chartHeight)} H ${String(padding.left)} Z`;

  // Compute total path length estimate for dash animation
  const totalPathLength = 2000;

  const formatPrice = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const gradientId = 'priceGradient';
  const glowFilterId = 'dotGlow';

  return (
    <div ref={containerRef} className="w-full">
      <style>{`
        @keyframes drawLine {
          from { stroke-dashoffset: ${String(totalPathLength)}; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes fadeInFill {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulseRing {
          0%, 100% { r: 6; opacity: 0.6; }
          50% { r: 10; opacity: 0; }
        }
        @keyframes dotAppear {
          from { opacity: 0; transform: scale(0); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes dropLabelAppear {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={`Price history chart showing ${String(steps.length)} price changes. Current lowest: ${formatPrice(lastStep.price)}`}
      >
        <defs>
          {/* Gradient fill under the line */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
            <stop offset="70%" stopColor="#22c55e" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>

          {/* Glow filter for dots */}
          <filter id={glowFilterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = padding.top + frac * chartHeight;
          const price = yMax - frac * (yMax - yMin);
          const currentPriceY = scaleY(lastStep.price);
          const tooClose = Math.abs(y - currentPriceY) < 16;
          return (
            <g key={String(frac)}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="currentColor"
                className="text-muted-foreground/20"
                strokeDasharray="2 6"
              />
              {!tooClose ? (
                <text
                  x={width - padding.right + 6}
                  y={y + 4}
                  className="fill-muted-foreground/50 text-[10px]"
                >
                  {formatPrice(price)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Gradient fill area */}
        <path
          d={fillPathD}
          fill={`url(#${gradientId})`}
          style={{
            animation: mounted ? 'fadeInFill 1s ease-out forwards' : 'none',
            opacity: mounted ? 1 : 0,
          }}
        />

        {/* Animated step line */}
        <path
          d={pathD}
          fill="none"
          stroke="#22c55e"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={totalPathLength}
          strokeDashoffset={mounted ? 0 : totalPathLength}
          style={{
            transition: mounted ? 'stroke-dashoffset 1.2s ease-out' : 'none',
          }}
        />

        {/* Glow line (thicker, blurred) */}
        <path
          d={pathD}
          fill="none"
          stroke="#22c55e"
          strokeWidth={6}
          strokeLinecap="round"
          opacity={0.15}
          strokeDasharray={totalPathLength}
          strokeDashoffset={mounted ? 0 : totalPathLength}
          style={{
            transition: mounted ? 'stroke-dashoffset 1.2s ease-out' : 'none',
          }}
        />

        {/* Drop points with glow */}
        {steps.map((step, i) => {
          const cx = scaleX(step.time);
          const cy = scaleY(step.price);
          const isLast = i === steps.length - 1;
          return (
            <g
              key={`${String(step.time)}-${String(i)}`}
              style={{
                opacity: mounted ? 1 : 0,
                transition: `opacity 0.3s ease-out ${String(0.8 + i * 0.1)}s`,
              }}
            >
              {/* Outer glow */}
              <circle
                cx={cx}
                cy={cy}
                r={isLast ? 5 : 3.5}
                fill="#22c55e"
                filter={`url(#${glowFilterId})`}
                opacity={0.6}
              />
              {/* Main dot */}
              <circle
                cx={cx}
                cy={cy}
                r={isLast ? 5 : 3.5}
                fill="#22c55e"
                stroke="#0a0a0a"
                strokeWidth={2}
              >
                <title>{`${formatPrice(step.amount)} at ${new Date(step.time).toLocaleTimeString()}`}</title>
              </circle>
              {/* Pulsing ring on current (last) price point */}
              {isLast ? (
                <>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    opacity={0.6}
                    style={{
                      animation: 'pulseRing 2s ease-out infinite',
                      transformOrigin: `${String(cx)}px ${String(cy)}px`,
                    }}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={1}
                    opacity={0.3}
                    style={{
                      animation: 'pulseRing 2s ease-out 1s infinite',
                      transformOrigin: `${String(cx)}px ${String(cy)}px`,
                    }}
                  />
                </>
              ) : null}
            </g>
          );
        })}

        {/* Significant drop annotations */}
        {significantDrops.map((drop) => {
          const step = steps[drop.index];
          if (!step) return null;
          const cx = scaleX(step.time);
          const cy = scaleY(step.price);
          return (
            <text
              key={`drop-${String(drop.index)}`}
              x={cx}
              y={cy - 12}
              textAnchor="middle"
              className="fill-green-400 text-[10px] font-bold"
              style={{
                opacity: mounted ? 1 : 0,
                animation: mounted
                  ? `dropLabelAppear 0.3s ease-out ${String(1 + drop.index * 0.1)}s both`
                  : 'none',
              }}
            >
              {`-${formatPrice(drop.dropCents)}`}
            </text>
          );
        })}

        {/* Current price label (right side) */}
        <g
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s ease-out 1s',
          }}
        >
          {/* Background pill for price label */}
          <rect
            x={width - padding.right + 2}
            y={scaleY(lastStep.price) - 10}
            width={56}
            height={20}
            rx={4}
            fill="#22c55e"
            opacity={0.15}
          />
          <text
            x={width - padding.right + 6}
            y={scaleY(lastStep.price) + 4}
            className="text-xs font-bold"
            fill="#22c55e"
          >
            {formatPrice(lastStep.price)}
          </text>
        </g>
      </svg>
    </div>
  );
}
