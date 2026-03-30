'use client';

import { useCallback, useMemo } from 'react';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout';
import type { Layout, LayoutItem, ResponsiveLayouts } from 'react-grid-layout';
import { GripVertical, X } from 'lucide-react';

import { useTerminalLayoutStore } from '@/stores/terminal-layout-store';
import { getWidgetById } from './widget-registry';
import { WidgetRenderer } from './widget-renderer';
import type { SimulationData, WidgetProps } from './types';
import type { MarketRange } from '@/types';

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

  // Build RGL layouts for each breakpoint
  const rglLayouts = useMemo(() => {
    const lg: LayoutItem[] = widgets.map((wp) => {
      const def = getWidgetById(wp.widgetId);
      return {
        i: wp.widgetId,
        x: wp.layout.x,
        y: wp.layout.y,
        w: wp.layout.w,
        h: wp.layout.h,
        minW: def?.minSize.w ?? 2,
        minH: def?.minSize.h ?? 2,
        maxW: def?.maxSize?.w,
        maxH: def?.maxSize?.h,
        isDraggable: isEditing,
        isResizable: isEditing,
      };
    });

    // Medium: clamp to 8 cols
    const md: LayoutItem[] = lg.map((item) => ({
      ...item,
      w: Math.min(item.w, 8),
      x: Math.min(item.x, Math.max(0, 8 - Math.min(item.w, 8))),
    }));

    // Small: force full width
    const sm: LayoutItem[] = lg.map((item, idx) => ({
      ...item,
      w: 6,
      x: 0,
      y: idx * item.h,
    }));

    return { lg, md, sm };
  }, [widgets, isEditing]);

  const handleLayoutChange = useCallback(
    (layout: Layout, _layouts: ResponsiveLayouts) => {
      if (!isEditing) return;
      const mapped = layout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }));
      updateWidgetLayouts(mapped);
    },
    [isEditing, updateWidgetLayouts],
  );

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
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed p-8">
          <p className="text-muted-foreground text-sm">
            No widgets added. Click &quot;Add Widget&quot; to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
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
        >
          {widgets.map((wp) => {
            const def = getWidgetById(wp.widgetId);
            return (
              <div
                key={wp.widgetId}
                className={`group/widget border-border/50 bg-card overflow-hidden rounded-xl border shadow-sm transition-shadow ${
                  isEditing
                    ? 'ring-1 ring-dashed ring-border/60 hover:shadow-md hover:ring-primary/30'
                    : ''
                }`}
              >
                {/* Edit mode header */}
                {isEditing && (
                  <div className="border-border/30 bg-muted/30 flex h-7 shrink-0 items-center gap-1 border-b px-2">
                    <div className="widget-drag-handle cursor-grab active:cursor-grabbing">
                      <GripVertical className="text-muted-foreground/60 h-3.5 w-3.5" />
                    </div>
                    <span className="text-muted-foreground flex-1 truncate text-[10px] font-medium">
                      {def?.label ?? wp.widgetId}
                    </span>
                    <button
                      onClick={() => removeWidget(wp.widgetId)}
                      className="text-muted-foreground hover:text-destructive rounded p-0.5 transition-colors"
                      title="Remove widget"
                    >
                      <X className="h-3 w-3" />
                    </button>
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
