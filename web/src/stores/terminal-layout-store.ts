import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { WIDGET_MAP } from '@/components/terminal/widget-registry';

// ── Types ──

export interface WidgetPlacement {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TerminalLayout {
  id: string;
  name: string;
  widgets: WidgetPlacement[];
  createdAt: string;
  updatedAt: string;
}

interface TerminalLayoutState {
  layouts: TerminalLayout[];
  activeLayoutId: string;
  isEditing: boolean;
}

interface TerminalLayoutActions {
  setActiveLayout: (id: string) => void;
  createLayout: (name: string, widgets?: WidgetPlacement[]) => string;
  deleteLayout: (id: string) => void;
  renameLayout: (id: string, name: string) => void;
  duplicateLayout: (id: string) => string;
  addWidget: (widgetId: string) => void;
  removeWidget: (instanceKey: string) => void;
  updateWidgetLayouts: (
    layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>,
  ) => void;
  toggleEditing: () => void;
  setEditing: (editing: boolean) => void;
  resetToDefault: () => void;
}

// ── Helpers ──

function nowIso(): string {
  return new Date().toISOString();
}

const GRID_COLS = 12;

/** Find the first open Y position that doesn't overlap any existing widgets */
function findOpenPosition(
  existing: WidgetPlacement[],
  w: number,
  _h: number,
): { x: number; y: number } {
  if (existing.length === 0) return { x: 0, y: 0 };

  // Build a set of occupied rows for each column
  const maxY = Math.max(...existing.map((wp) => wp.y + wp.h));

  // Scan rows top-down for a horizontal gap wide enough
  for (let row = 0; row <= maxY; row++) {
    for (let col = 0; col <= GRID_COLS - w; col++) {
      const fits = existing.every((wp) => {
        // No overlap if widget is entirely left, right, above, or below
        const noOverlap =
          col + w <= wp.x || col >= wp.x + wp.w || row + _h <= wp.y || row >= wp.y + wp.h;
        return noOverlap;
      });
      if (fits) return { x: col, y: row };
    }
  }

  // Fallback: place below everything
  return { x: 0, y: maxY };
}

// ── Default preset layouts ──

const PRESET_TRADING_TERMINAL: WidgetPlacement[] = [
  // Row 0: price-hero full width
  { widgetId: 'price-hero', x: 0, y: 0, w: 12, h: 4 },
  // Row 4: savings + price-chart left, order-book + top-providers center, activity-feed + social-proof right
  { widgetId: 'savings', x: 0, y: 4, w: 5, h: 4 },
  { widgetId: 'price-chart', x: 0, y: 8, w: 5, h: 7 },
  { widgetId: 'order-book', x: 5, y: 4, w: 4, h: 10 },
  { widgetId: 'top-providers', x: 5, y: 14, w: 4, h: 6 },
  { widgetId: 'activity-feed', x: 9, y: 4, w: 3, h: 10 },
  { widgetId: 'social-proof', x: 9, y: 14, w: 3, h: 4 },
  // Below
  { widgetId: 'depth-chart', x: 0, y: 15, w: 5, h: 7 },
  { widgetId: 'bid-trend', x: 0, y: 22, w: 5, h: 5 },
  { widgetId: 'market-intel', x: 5, y: 20, w: 4, h: 5 },
  { widgetId: 'job-details', x: 0, y: 27, w: 12, h: 4 },
];

const PRESET_MARKET_OVERVIEW: WidgetPlacement[] = [
  { widgetId: 'price-hero', x: 0, y: 0, w: 12, h: 4 },
  { widgetId: 'savings', x: 0, y: 4, w: 6, h: 4 },
  { widgetId: 'market-intel', x: 6, y: 4, w: 6, h: 5 },
  { widgetId: 'price-chart', x: 0, y: 8, w: 6, h: 7 },
  { widgetId: 'depth-chart', x: 6, y: 9, w: 6, h: 7 },
];

const PRESET_MINIMAL: WidgetPlacement[] = [
  { widgetId: 'price-hero', x: 0, y: 0, w: 12, h: 4 },
  { widgetId: 'savings', x: 0, y: 4, w: 6, h: 4 },
  { widgetId: 'order-book', x: 6, y: 4, w: 6, h: 10 },
];

function makePresetLayout(id: string, name: string, widgets: WidgetPlacement[]): TerminalLayout {
  const ts = nowIso();
  return { id, name, widgets, createdAt: ts, updatedAt: ts };
}

const DEFAULT_LAYOUTS: TerminalLayout[] = [
  makePresetLayout('preset-trading', 'Trading Terminal', PRESET_TRADING_TERMINAL),
  makePresetLayout('preset-overview', 'Market Overview', PRESET_MARKET_OVERVIEW),
  makePresetLayout('preset-minimal', 'Minimal', PRESET_MINIMAL),
];

const PRESET_MAP: Record<string, WidgetPlacement[]> = {
  'preset-trading': PRESET_TRADING_TERMINAL,
  'preset-overview': PRESET_MARKET_OVERVIEW,
  'preset-minimal': PRESET_MINIMAL,
};

// ── Store ──

export const useTerminalLayoutStore = create<TerminalLayoutState & TerminalLayoutActions>()(
  persist(
    (set, get) => ({
      layouts: DEFAULT_LAYOUTS,
      activeLayoutId: 'preset-trading',
      isEditing: false,

      setActiveLayout: (id) => {
        set({ activeLayoutId: id, isEditing: false });
      },

      createLayout: (name, widgets) => {
        const id = crypto.randomUUID();
        const ts = nowIso();
        const layout: TerminalLayout = {
          id,
          name,
          widgets: widgets ?? [{ widgetId: 'price-hero', x: 0, y: 0, w: 12, h: 4 }],
          createdAt: ts,
          updatedAt: ts,
        };
        set((state) => ({
          layouts: [...state.layouts, layout],
          activeLayoutId: id,
          isEditing: true,
        }));
        return id;
      },

      deleteLayout: (id) => {
        const { layouts, activeLayoutId } = get();
        if (layouts.length <= 1) return;
        const remaining = layouts.filter((l) => l.id !== id);
        const newActive =
          activeLayoutId === id ? (remaining[0]?.id ?? activeLayoutId) : activeLayoutId;
        set({ layouts: remaining, activeLayoutId: newActive });
      },

      renameLayout: (id, name) => {
        set((state) => ({
          layouts: state.layouts.map((l) =>
            l.id === id ? { ...l, name, updatedAt: nowIso() } : l,
          ),
        }));
      },

      duplicateLayout: (id) => {
        const { layouts } = get();
        const source = layouts.find((l) => l.id === id);
        if (!source) return id;
        const newId = crypto.randomUUID();
        const ts = nowIso();
        const dupe: TerminalLayout = {
          ...source,
          id: newId,
          name: `${source.name} (Copy)`,
          widgets: source.widgets.map((w) => ({ ...w })),
          createdAt: ts,
          updatedAt: ts,
        };
        set((state) => ({
          layouts: [...state.layouts, dupe],
          activeLayoutId: newId,
        }));
        return newId;
      },

      addWidget: (widgetId) => {
        const def = WIDGET_MAP[widgetId];
        if (!def) return;
        set((state) => {
          const layout = state.layouts.find((l) => l.id === state.activeLayoutId);
          if (!layout) return state;
          // Don't add if already present
          if (layout.widgets.some((w) => w.widgetId === widgetId)) return state;
          const pos = findOpenPosition(layout.widgets, def.defaultSize.w, def.defaultSize.h);
          const newWidget: WidgetPlacement = {
            widgetId,
            x: pos.x,
            y: pos.y,
            w: def.defaultSize.w,
            h: def.defaultSize.h,
          };
          return {
            layouts: state.layouts.map((l) =>
              l.id === state.activeLayoutId
                ? {
                    ...l,
                    widgets: [...l.widgets, newWidget],
                    updatedAt: nowIso(),
                  }
                : l,
            ),
          };
        });
      },

      removeWidget: (instanceKey) => {
        set((state) => ({
          layouts: state.layouts.map((l) =>
            l.id === state.activeLayoutId
              ? {
                  ...l,
                  widgets: l.widgets.filter((w) => w.widgetId !== instanceKey),
                  updatedAt: nowIso(),
                }
              : l,
          ),
        }));
      },

      updateWidgetLayouts: (rglLayouts) => {
        set((state) => {
          const current = state.layouts.find((l) => l.id === state.activeLayoutId);
          if (!current) return state;
          const updatedWidgets = current.widgets.map((wp) => {
            const rgl = rglLayouts.find((r) => r.i === wp.widgetId);
            if (!rgl) return wp;
            return {
              ...wp,
              x: rgl.x,
              y: rgl.y,
              w: rgl.w,
              h: rgl.h,
            };
          });
          return {
            layouts: state.layouts.map((l) =>
              l.id === state.activeLayoutId
                ? { ...l, widgets: updatedWidgets, updatedAt: nowIso() }
                : l,
            ),
          };
        });
      },

      toggleEditing: () => {
        set((state) => ({ isEditing: !state.isEditing }));
      },

      setEditing: (editing) => {
        set({ isEditing: editing });
      },

      resetToDefault: () => {
        const { activeLayoutId } = get();
        const preset = PRESET_MAP[activeLayoutId];
        if (preset) {
          set((state) => ({
            layouts: state.layouts.map((l) =>
              l.id === activeLayoutId
                ? {
                    ...l,
                    widgets: preset.map((w) => ({ ...w })),
                    updatedAt: nowIso(),
                  }
                : l,
            ),
          }));
        }
      },
    }),
    {
      name: 'nomarkup-terminal-layouts',
      version: 2,
    },
  ),
);
