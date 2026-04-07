'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout, LayoutItem, ResponsiveLayouts } from 'react-grid-layout';
import { GripVertical, X } from 'lucide-react';

import { useTerminalLayoutStore } from '@/stores/terminal-layout-store';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getWidgetById } from './widget-registry';
import { WidgetRenderer } from './widget-renderer';
import type { SimulationData, WidgetProps } from './types';
import type { MarketRange } from '@/types';

/** Widget IDs whose data is "live" — these get the animated green border glow */
const LIVE_WIDGET_IDS = new Set([
  'price-chart',
  'depth-chart',
  'bid-trend',
  'activity-feed',
  'order-book',
]);

interface MockProvider {
  name: string;
  trust: number;
  tier: string;
  initial: string;
}

interface TerminalGridProps {
  sim: SimulationData;
  auctionEndsAt: string;
  startingPriceCents: number;
  marketRange: MarketRange;
  mockProviders: readonly MockProvider[];
}

export function TerminalGrid({
  sim,
  auctionEndsAt,
  startingPriceCents,
  marketRange,
  mockProviders,
}: TerminalGridProps) {
  const { layouts, activeLayoutId, isEditing, removeWidget, updateWidgetLayouts } =
    useTerminalLayoutStore();

  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1200,
  });

  const activeLayout = layouts.find((l) => l.id === activeLayoutId);
  const widgets = activeLayout?.widgets ?? [];

  // Serialize widgets to a stable key so we only recompute layouts when data actually changes
  const widgetsKey = useMemo(
    () =>
      widgets
        .map((w) => `${w.widgetId}:${String(w.x)},${String(w.y)},${String(w.w)},${String(w.h)}`)
        .join('|'),
    [widgets],
  );

  // Build RGL layouts — only recompute when widget positions or editing state actually change
  const rglLayouts = useMemo(() => {
    const lg: LayoutItem[] = widgets.map((wp) => {
      const def = getWidgetById(wp.widgetId);
      return {
        i: wp.widgetId,
        x: wp.x,
        y: wp.y,
        w: wp.w,
        h: wp.h,
        minW: def?.minSize.w ?? 2,
        minH: def?.minSize.h ?? 2,
        maxW: def?.maxSize?.w,
        maxH: def?.maxSize?.h,
        isDraggable: isEditing,
        isResizable: isEditing,
      };
    });

    const md: LayoutItem[] = lg.map((item) => ({
      ...item,
      w: Math.min(item.w, 8),
      x: Math.min(item.x, Math.max(0, 8 - Math.min(item.w, 8))),
    }));

    const sm: LayoutItem[] = lg.map((item, idx) => ({
      ...item,
      w: 6,
      x: 0,
      y: idx * item.h,
    }));

    return { lg, md, sm };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetsKey, isEditing]);

  // Track whether a drag/resize is in progress to avoid loop
  const [isDragging, setIsDragging] = useState(false);

  const handleLayoutChange = useCallback(
    (layout: Layout, _layouts: ResponsiveLayouts) => {
      // Only persist to store when user is actively dragging/resizing
      if (!isDragging) return;
      const mapped = layout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }));
      updateWidgetLayouts(mapped);
    },
    [isDragging, updateWidgetLayouts],
  );

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);
  const handleDragStop = useCallback(() => {
    setIsDragging(false);
  }, []);
  const handleResizeStart = useCallback(() => {
    setIsDragging(true);
  }, []);
  const handleResizeStop = useCallback(() => {
    setIsDragging(false);
  }, []);

  const widgetProps: WidgetProps = useMemo(
    () => ({
      sim,
      auctionEndsAt,
      startingPriceCents,
      marketRange,
      mockProviders,
    }),
    [sim, auctionEndsAt, startingPriceCents, marketRange, mockProviders],
  );

  if (widgets.length === 0) {
    return (
      <div ref={containerRef}>
        <div className="glass flex min-h-[200px] items-center justify-center border-dashed border-white/10 p-8">
          <p className="text-sm text-zinc-400">
            No widgets added. Click &quot;Add Widget&quot; to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <style>{`
        @keyframes terminalGlow {
          0%, 100% { border-color: rgba(34, 197, 94, 0.15); box-shadow: 0 0 6px rgba(34, 197, 94, 0.05); }
          50% { border-color: rgba(34, 197, 94, 0.35); box-shadow: 0 0 12px rgba(34, 197, 94, 0.1); }
        }
      `}</style>
      {mounted && (
        <ResponsiveGridLayout
          className="terminal-grid"
          width={width}
          layouts={rglLayouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768 }}
          cols={{ lg: 12, md: 8, sm: 6 }}
          rowHeight={40}
          margin={[12, 12] as const}
          containerPadding={[0, 0] as const}
          compactor={verticalCompactor}
          dragConfig={{
            enabled: isEditing,
            handle: '.widget-drag-handle',
            bounded: false,
            threshold: 3,
          }}
          resizeConfig={{
            enabled: isEditing,
            handles: ['se'] as const,
          }}
          onLayoutChange={handleLayoutChange}
          onDragStart={handleDragStart}
          onDragStop={handleDragStop}
          onResizeStart={handleResizeStart}
          onResizeStop={handleResizeStop}
        >
          {widgets.map((wp) => {
            const def = getWidgetById(wp.widgetId);
            const isLive = LIVE_WIDGET_IDS.has(wp.widgetId) && sim.isRunning;
            return (
              <div
                key={wp.widgetId}
                className={`group/widget overflow-hidden rounded-2xl transition-shadow ${
                  isEditing
                    ? 'border border-dashed border-[var(--brand-gold)]/30 bg-[#0d1120] hover:border-[var(--brand-gold)]/50 hover:shadow-md'
                    : 'bg-[#0d1120]'
                }`}
                style={
                  !isEditing
                    ? {
                        border: '1px solid transparent',
                        backgroundImage: isLive
                          ? 'linear-gradient(#0d1120, #0d1120), linear-gradient(135deg, rgba(34,197,94,0.45), rgba(201,168,76,0.12), rgba(201,168,76,0.3))'
                          : 'linear-gradient(#0d1120, #0d1120), linear-gradient(135deg, rgba(201,168,76,0.4), rgba(201,168,76,0.1), rgba(201,168,76,0.3))',
                        backgroundOrigin: 'border-box',
                        backgroundClip: 'padding-box, border-box',
                        boxShadow:
                          'inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.08)',
                      }
                    : undefined
                }
              >
                {/* Edit mode header */}
                {isEditing && (
                  <div className="glass-header flex h-7 shrink-0 items-center gap-1 px-2">
                    <div className="widget-drag-handle cursor-grab active:cursor-grabbing">
                      <GripVertical className="h-3.5 w-3.5 text-zinc-500" />
                    </div>
                    <span className="flex-1 truncate text-[10px] font-medium text-zinc-400">
                      {def?.label ?? wp.widgetId}
                    </span>
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => removeWidget(wp.widgetId)}
                          className="rounded p-0.5 text-zinc-500 transition-colors hover:text-red-400"
                          aria-label={`Remove ${def?.label ?? wp.widgetId} widget`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Remove widget</TooltipContent>
                    </Tooltip>
                  </div>
                )}
                {/* Widget content */}
                <div className={`${isEditing ? 'h-[calc(100%-28px)]' : 'h-full'}`}>
                  <WidgetRenderer widgetId={wp.widgetId} widgetProps={widgetProps} />
                </div>
              </div>
            );
          })}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
