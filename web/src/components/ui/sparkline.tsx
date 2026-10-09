'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  gradientFill?: boolean;
  showLastDot?: boolean;
  className?: string;
}

/** Generate smooth bezier curve control points for a set of data points. */
function buildSmoothPath(
  points: Array<{ x: number; y: number }>,
): string {
  if (points.length < 2) return '';

  const first = points[0];
  if (!first) return '';

  let d = `M ${String(first.x)},${String(first.y)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    if (!current || !next) continue;

    // Simple catmull-rom-to-bezier approach
    const prev = points[i - 1] ?? current;
    const afterNext = points[i + 2] ?? next;

    const cp1x = current.x + (next.x - prev.x) / 6;
    const cp1y = current.y + (next.y - prev.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;

    d += ` C ${String(cp1x)},${String(cp1y)} ${String(cp2x)},${String(cp2y)} ${String(next.x)},${String(next.y)}`;
  }

  return d;
}

export function Sparkline({
  data,
  width = 120,
  height = 40,
  color,
  gradientFill = true,
  showLastDot = true,
  className,
}: SparklineProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);

  const safeData = data.length >= 2 ? data : [0, 0];

  // Determine trend color: last > first = green (up), last < first = red (down)
  const firstVal = safeData[0] ?? 0;
  const lastVal = safeData[safeData.length - 1] ?? 0;
  const trend = lastVal >= firstVal ? 'up' : 'down';
  // Semantic tokens — SVG accepts CSS vars in stroke/fill/stopColor.
  const resolvedColor =
    color ?? (trend === 'up' ? 'var(--brand-green)' : 'var(--destructive)');

  // Compute points within padded SVG area
  const paddingX = 4;
  const paddingY = 6;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  const minVal = Math.min(...safeData);
  const maxVal = Math.max(...safeData);
  const range = maxVal - minVal || 1;

  const points = safeData.map((val, i) => ({
    x: paddingX + (i / (safeData.length - 1)) * innerWidth,
    y: paddingY + (1 - (val - minVal) / range) * innerHeight,
  }));

  const linePath = buildSmoothPath(points);

  // Build a closed path for the gradient fill area
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const fillPath =
    linePath && firstPoint && lastPoint
      ? `${linePath} L ${String(lastPoint.x)},${String(height)} L ${String(firstPoint.x)},${String(height)} Z`
      : '';

  // Stable id without raw hex — sanitize optional color overrides for multi-sparkline pages.
  const colorKey = (color ?? trend).replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `sparkline-gradient-${String(width)}-${String(height)}-${colorKey}`;

  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [linePath]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      // width/height set the intrinsic aspect via the viewBox; max-w-full + h-auto
      // let the chart shrink to its container so a wide sparkline never overflows
      // on mobile (preserveAspectRatio defaults to uniform scaling).
      className={cn('h-auto max-w-full overflow-visible', className)}
      role="img"
      aria-label={`Sparkline chart showing ${trend === 'up' ? 'upward' : 'downward'} trend`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={resolvedColor} stopOpacity={0.3} />
          <stop offset="100%" stopColor={resolvedColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Gradient fill under the curve */}
      {gradientFill && fillPath ? (
        <path d={fillPath} fill={`url(#${gradientId})`} />
      ) : null}

      {/* Line path with stroke-draw animation */}
      {linePath ? (
        <path
          ref={pathRef}
          d={linePath}
          fill="none"
          stroke={resolvedColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={
            pathLength > 0
              ? {
                  strokeDasharray: pathLength,
                  strokeDashoffset: pathLength,
                  // Use CSS custom property for the keyframe reference
                  ['--sparkline-length' as string]: pathLength,
                  animation: `sparkline-draw 1s ease-out forwards`,
                  willChange: 'stroke-dashoffset',
                }
              : undefined
          }
        />
      ) : null}

      {/* Pulsing dot at the last data point */}
      {showLastDot && lastPoint ? (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r={3}
          fill={resolvedColor}
          className="animate-pulse-dot"
          style={{ willChange: 'r, opacity' }}
        />
      ) : null}
    </svg>
  );
}
