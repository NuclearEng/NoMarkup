import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { WIDGET_REGISTRY, getWidgetById } from '@/components/terminal/widget-registry';

// ── Types ──

interface WidgetPlacement {
  widgetId: string;
  layout: { x: number; y: number; w: number; h: number };
}

interface TerminalLayout {
  id: string;
  name: string;
  widgets: WidgetPlacement[];
  createdAt: string;
  updatedAt: string;
}

interface TerminalLayoutStore {
  layouts: TerminalLayout[];
  activeLayoutId: string;
  isEditing: boolean;

  // Actions
  setActiveLayout: (id: string) => void;
  createLayout: (name: string) => string;
  deleteLayout: (id: string) => void;
  renameLayout: (id: string, name: string) => void;
  duplicateLayout: (id: string) => string;

  addWidget: (widgetId: string) => void;
  removeWidget: (widgetId: string) => void;
  updateWidgetLayouts: (
    layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>,
  ) => void;

  toggleEditing: () => void;
  resetToDefault: () => void;
}

// ── Helpers ──

function generateId(): string {
  return `layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Find the first open Y position that doesn't overlap any existing widgets */
function findOpenPosition(
  existing: WidgetPlacement[],
  w: number,
  h: number,
): { x: number; y: number } {
  if (existing.length === 0) return { x: 0, y: 0 };
  const maxY = Math.max(...existing.map((wp) => wp.layout.y + wp.layout.h));
  return { x: 0, y: maxY };
}

// ── Default preset layouts ──

const PRESET_TRADING_TERMINAL: WidgetPlacement[] = [
  { widgetId: 'price-hero', layout: { x: 0, y: 0, w: 12, h: 5 } },
  { widgetId: 'savings', layout: { x: 0, y: 5, w: 5, h: 4 } },
  { widgetId: 'velocity', layout: { x: 5, y: 5, w: 3, h: 4 } },
  { widgetId: 'social-proof', layout: { x: 8, y: 5, w: 4, h: 4 } },
  { widgetId: 'price-chart', layout: { x: 0, y: 9, w: 5, h: 7 } },
  { widgetId: 'order-book', layout: { x: 5, y: 9, w: 4, h: 10 } },
  { widgetId: 'activity-feed', layout: { x: 9, y: 9, w: 3, h: 10 } },
  { widgetId: 'depth-chart', layout: { x: 0, y: 16, w: 5, h: 7 } },
  { widgetId: 'market-intel', layout: { x: 0, y: 23, w: 5, h: 5 } },
  { widgetId: 'top-providers', layout: { x: 5, y: 19, w: 4, h: 6 } },
  { widgetId: 'bid-trend', layout: { x: 9, y: 19, w: 3, h: 5 } },
  { widgetId: 'job-details', layout: { x: 0, y: 28, w: 12, h: 5 } },
];

const PRESET_MARKET_OVERVIEW: WidgetPlacement[] = [
  { widgetId: 'price-hero', layout: { x: 0, y: 0, w: 12, h: 5 } },
  { widgetId: 'price-chart', layout: { x: 0, y: 5, w: 6, h: 7 } },
  { widgetId: 'depth-chart', layout: { x: 6, y: 5, w: 6, h: 7 } },
  { widgetId: 'market-intel', layout: { x: 0, y: 12, w: 6, h: 5 } },
  { widgetId: 'bid-trend', layout: { x: 6, y: 12, w: 6, h: 5 } },
  { widgetId: 'savings', layout: { x: 0, y: 17, w: 6, h: 4 } },
  { widgetId: 'social-proof', layout: { x: 6, y: 17, w: 6, h: 4 } },
];

const PRESET_MINIMAL: WidgetPlacement[] = [
  { widgetId: 'price-hero', layout: { x: 0, y: 0, w: 12, h: 5 } },
  { widgetId: 'savings', layout: { x: 0, y: 5, w: 6, h: 4 } },
  { widgetId: 'order-book', layout: { x: 6, y: 5, w: 6, h: 10 } },
];

function makePresetLayout(
  id: string,
  name: string,
  widgets: WidgetPlacement[],
): TerminalLayout {
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

export const useTerminalLayoutStore = create<TerminalLayoutStore>()(
  persist(
    (set, get) => ({
      layouts: DEFAULT_LAYOUTS,
      activeLayoutId: 'preset-trading',
      isEditing: false,

      setActiveLayout: (id) => {
        set({ activeLayoutId: id, isEditing: false });
      },

      createLayout: (name) => {
        const id = generateId();
        const ts = nowIso();
        const layout: TerminalLayout = {
          id,
          name,
          widgets: [
            {
              widgetId: 'price-hero',
              layout: { x: 0, y: 0, w: 12, h: 5 },
            },
          ],
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
        const newId = generateId();
        const ts = nowIso();
        const dupe: TerminalLayout = {
          ...source,
          id: newId,
          name: `${source.name} (Copy)`,
          widgets: source.widgets.map((w) => ({ ...w, layout: { ...w.layout } })),
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
        const def = getWidgetById(widgetId);
        if (!def) return;
        set((state) => {
          const layout = state.layouts.find((l) => l.id === state.activeLayoutId);
          if (!layout) return state;
          // Don't add if already present
          if (layout.widgets.some((w) => w.widgetId === widgetId)) return state;
          const pos = findOpenPosition(layout.widgets, def.defaultSize.w, def.defaultSize.h);
          const newWidget: WidgetPlacement = {
            widgetId,
            layout: { ...pos, w: def.defaultSize.w, h: def.defaultSize.h },
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

      removeWidget: (widgetId) => {
        set((state) => ({
          layouts: state.layouts.map((l) =>
            l.id === state.activeLayoutId
              ? {
                  ...l,
                  widgets: l.widgets.filter((w) => w.widgetId !== widgetId),
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
              layout: { x: rgl.x, y: rgl.y, w: rgl.w, h: rgl.h },
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

      resetToDefault: () => {
        const { activeLayoutId } = get();
        const preset = PRESET_MAP[activeLayoutId];
        if (preset) {
          set((state) => ({
            layouts: state.layouts.map((l) =>
              l.id === activeLayoutId
                ? { ...l, widgets: preset.map((w) => ({ ...w, layout: { ...w.layout } })), updatedAt: nowIso() }
                : l,
            ),
          }));
        }
      },
    }),
    {
      name: 'nomarkup-terminal-layouts',
      version: 1,
    },
  ),
);
