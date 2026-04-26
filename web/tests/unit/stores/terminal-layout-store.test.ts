import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Zustand's persist middleware captures `localStorage` at module init time
// via `() => localStorage`. In jsdom that resolves to a Storage instance,
// but methods are not always bound, leading to "storage.setItem is not a
// function" once it's invoked through a destructured reference. Install a
// minimal in-memory shim BEFORE importing the store so persist gets a
// well-formed Storage object.
const memoryStore = new Map<string, string>();
const memoryStorage: Storage = {
  get length(): number {
    return memoryStore.size;
  },
  clear: () => {
    memoryStore.clear();
  },
  getItem: (key: string) => memoryStore.get(key) ?? null,
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  removeItem: (key: string) => {
    memoryStore.delete(key);
  },
  setItem: (key: string, value: string) => {
    memoryStore.set(key, value);
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
});

// Mock the widget registry so the store has a known set of widget defs
vi.mock('@/components/terminal/widget-registry', () => ({
  WIDGET_MAP: {
    'price-hero': { defaultSize: { w: 12, h: 4 } },
    savings: { defaultSize: { w: 6, h: 4 } },
    'order-book': { defaultSize: { w: 4, h: 10 } },
    'price-chart': { defaultSize: { w: 6, h: 7 } },
    'depth-chart': { defaultSize: { w: 6, h: 7 } },
    'market-intel': { defaultSize: { w: 6, h: 5 } },
    'top-providers': { defaultSize: { w: 4, h: 6 } },
    'activity-feed': { defaultSize: { w: 3, h: 10 } },
    'social-proof': { defaultSize: { w: 3, h: 4 } },
    'bid-trend': { defaultSize: { w: 6, h: 4 } },
    'job-details': { defaultSize: { w: 12, h: 4 } },
  },
}));

// Import after mocks
const { useTerminalLayoutStore } = await import(
  '@/stores/terminal-layout-store'
);

const PRESET_TRADING_ID = 'preset-trading';
const PRESET_OVERVIEW_ID = 'preset-overview';
const PRESET_MINIMAL_ID = 'preset-minimal';

// Snapshot of the pristine initial state so we can reset between tests.
const PRISTINE_STATE = useTerminalLayoutStore.getState();
// Capture the default layouts as a deep clone so per-test mutations don't bleed.
function freshDefaults(): typeof PRISTINE_STATE.layouts {
  return PRISTINE_STATE.layouts.map((l) => ({
    ...l,
    widgets: l.widgets.map((w) => ({ ...w })),
  }));
}

function resetStore(): void {
  useTerminalLayoutStore.setState({
    layouts: freshDefaults(),
    activeLayoutId: PRESET_TRADING_ID,
    isEditing: false,
  });
}

describe('useTerminalLayoutStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    memoryStore.clear();
  });

  describe('initial state', () => {
    it('starts with the three preset layouts', () => {
      const state = useTerminalLayoutStore.getState();
      const ids = state.layouts.map((l) => l.id);
      expect(ids).toContain(PRESET_TRADING_ID);
      expect(ids).toContain(PRESET_OVERVIEW_ID);
      expect(ids).toContain(PRESET_MINIMAL_ID);
    });

    it('starts on the trading terminal preset, not editing', () => {
      const state = useTerminalLayoutStore.getState();
      expect(state.activeLayoutId).toBe(PRESET_TRADING_ID);
      expect(state.isEditing).toBe(false);
    });
  });

  describe('setActiveLayout', () => {
    it('switches the active layout and exits editing mode', () => {
      useTerminalLayoutStore.setState({ isEditing: true });
      useTerminalLayoutStore
        .getState()
        .setActiveLayout(PRESET_MINIMAL_ID);

      const state = useTerminalLayoutStore.getState();
      expect(state.activeLayoutId).toBe(PRESET_MINIMAL_ID);
      expect(state.isEditing).toBe(false);
    });
  });

  describe('createLayout', () => {
    it('appends a new layout, sets it active, and enters editing', () => {
      const id = useTerminalLayoutStore
        .getState()
        .createLayout('My Layout');

      const state = useTerminalLayoutStore.getState();
      expect(state.activeLayoutId).toBe(id);
      expect(state.isEditing).toBe(true);
      const created = state.layouts.find((l) => l.id === id);
      expect(created).toBeDefined();
      if (created) {
        expect(created.name).toBe('My Layout');
        expect(created.widgets).toHaveLength(1);
      }
    });

    it('honors a custom widget seed', () => {
      const id = useTerminalLayoutStore.getState().createLayout('Seeded', [
        { widgetId: 'savings', x: 0, y: 0, w: 6, h: 4 },
        { widgetId: 'order-book', x: 6, y: 0, w: 4, h: 10 },
      ]);

      const created = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(created).toBeDefined();
      if (created) {
        expect(created.widgets).toHaveLength(2);
      }
    });
  });

  describe('deleteLayout', () => {
    it('removes the layout and reassigns active if the active was deleted', () => {
      useTerminalLayoutStore.setState({ activeLayoutId: PRESET_MINIMAL_ID });
      useTerminalLayoutStore
        .getState()
        .deleteLayout(PRESET_MINIMAL_ID);

      const state = useTerminalLayoutStore.getState();
      expect(state.layouts.map((l) => l.id)).not.toContain(
        PRESET_MINIMAL_ID,
      );
      expect(state.activeLayoutId).not.toBe(PRESET_MINIMAL_ID);
    });

    it('refuses to delete the last remaining layout', () => {
      useTerminalLayoutStore.setState({
        layouts: [
          {
            id: 'only',
            name: 'Only',
            widgets: [],
            createdAt: '2026-04-24T00:00:00Z',
            updatedAt: '2026-04-24T00:00:00Z',
          },
        ],
        activeLayoutId: 'only',
      });

      useTerminalLayoutStore.getState().deleteLayout('only');

      expect(useTerminalLayoutStore.getState().layouts).toHaveLength(1);
    });

    it('keeps active layout if a different layout is deleted', () => {
      useTerminalLayoutStore.setState({ activeLayoutId: PRESET_TRADING_ID });
      useTerminalLayoutStore
        .getState()
        .deleteLayout(PRESET_MINIMAL_ID);

      expect(useTerminalLayoutStore.getState().activeLayoutId).toBe(
        PRESET_TRADING_ID,
      );
    });
  });

  describe('renameLayout', () => {
    it('updates the layout name and bumps updatedAt', () => {
      const before = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === PRESET_TRADING_ID);
      expect(before).toBeDefined();
      const beforeUpdated = before ? before.updatedAt : '';

      useTerminalLayoutStore
        .getState()
        .renameLayout(PRESET_TRADING_ID, 'New Name');

      const after = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === PRESET_TRADING_ID);
      expect(after).toBeDefined();
      if (after) {
        expect(after.name).toBe('New Name');
        expect(after.updatedAt >= beforeUpdated).toBe(true);
      }
    });
  });

  describe('duplicateLayout', () => {
    it('creates a deep copy with a "(Copy)" suffix and new id', () => {
      const newId = useTerminalLayoutStore
        .getState()
        .duplicateLayout(PRESET_TRADING_ID);

      expect(newId).not.toBe(PRESET_TRADING_ID);
      const state = useTerminalLayoutStore.getState();
      const dupe = state.layouts.find((l) => l.id === newId);
      const original = state.layouts.find(
        (l) => l.id === PRESET_TRADING_ID,
      );
      expect(dupe).toBeDefined();
      expect(original).toBeDefined();
      if (dupe && original) {
        expect(dupe.name).toBe(`${original.name} (Copy)`);
        expect(dupe.widgets).toHaveLength(original.widgets.length);
        // Deep copy: mutating the duplicate does not change the original
        const dupeFirst = dupe.widgets[0];
        const origFirst = original.widgets[0];
        expect(dupeFirst).toBeDefined();
        expect(origFirst).toBeDefined();
        if (dupeFirst && origFirst) {
          expect(dupeFirst).not.toBe(origFirst);
        }
      }
      expect(state.activeLayoutId).toBe(newId);
    });

    it('returns the original id when source layout is missing', () => {
      const result = useTerminalLayoutStore
        .getState()
        .duplicateLayout('does-not-exist');
      expect(result).toBe('does-not-exist');
    });
  });

  describe('addWidget', () => {
    it('appends a new widget to the active layout when not present', () => {
      // Start with an empty user layout
      const id = useTerminalLayoutStore.getState().createLayout('Empty', []);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().addWidget('savings');

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        expect(layout.widgets).toHaveLength(1);
        const first = layout.widgets[0];
        expect(first).toBeDefined();
        if (first) {
          expect(first.widgetId).toBe('savings');
          expect(first.w).toBe(6);
          expect(first.h).toBe(4);
        }
      }
    });

    it('does not add a widget that is already present', () => {
      const id = useTerminalLayoutStore.getState().createLayout('Solo', [
        { widgetId: 'savings', x: 0, y: 0, w: 6, h: 4 },
      ]);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().addWidget('savings');

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        expect(layout.widgets).toHaveLength(1);
      }
    });

    it('silently ignores unknown widget ids', () => {
      const id = useTerminalLayoutStore.getState().createLayout('Empty', []);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().addWidget('unknown-widget');

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        expect(layout.widgets).toHaveLength(0);
      }
    });

    it('places a new widget into an open horizontal gap on the same row', () => {
      // Existing layout occupies cols 0-5 (savings, w=6) on row 0.
      // Adding a w=4 widget should fit in the gap at cols 6-9 of row 0.
      const id = useTerminalLayoutStore.getState().createLayout('Sparse', [
        { widgetId: 'savings', x: 0, y: 0, w: 6, h: 4 },
      ]);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().addWidget('order-book'); // 4x10

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        const ob = layout.widgets.find((w) => w.widgetId === 'order-book');
        expect(ob).toBeDefined();
        if (ob) {
          // Found a fit on row 0 starting at col 6 (first column where the
          // widget doesn't overlap the existing 'savings' widget).
          expect(ob.x).toBe(6);
          expect(ob.y).toBe(0);
        }
      }
    });

    it('falls back to placing below all widgets when no horizontal gap fits', () => {
      // Pack the entire row 0 (12 cols) so there's no horizontal gap on row 0
      // for a 4-wide widget. The new widget should fall through the
      // findOpenPosition scan and land on the next row.
      const id = useTerminalLayoutStore.getState().createLayout('Full row', [
        { widgetId: 'price-hero', x: 0, y: 0, w: 12, h: 4 },
      ]);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().addWidget('order-book'); // 4x10

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        const ob = layout.widgets.find((w) => w.widgetId === 'order-book');
        expect(ob).toBeDefined();
        if (ob) {
          // Cannot fit on rows 0-3 (occupied). Should land on row 4 at col 0.
          expect(ob.y).toBeGreaterThanOrEqual(4);
        }
      }
    });
  });

  describe('removeWidget', () => {
    it('removes a widget from the active layout by widget id', () => {
      const id = useTerminalLayoutStore.getState().createLayout('Two', [
        { widgetId: 'savings', x: 0, y: 0, w: 6, h: 4 },
        { widgetId: 'order-book', x: 6, y: 0, w: 4, h: 10 },
      ]);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().removeWidget('savings');

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        expect(layout.widgets.map((w) => w.widgetId)).toEqual([
          'order-book',
        ]);
      }
    });
  });

  describe('updateWidgetLayouts', () => {
    it('applies new x/y/w/h from react-grid-layout output', () => {
      const id = useTerminalLayoutStore.getState().createLayout('Grid', [
        { widgetId: 'savings', x: 0, y: 0, w: 6, h: 4 },
      ]);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().updateWidgetLayouts([
        { i: 'savings', x: 4, y: 2, w: 8, h: 6 },
      ]);

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        const first = layout.widgets[0];
        expect(first).toBeDefined();
        if (first) {
          expect(first.x).toBe(4);
          expect(first.y).toBe(2);
          expect(first.w).toBe(8);
          expect(first.h).toBe(6);
        }
      }
    });

    it('leaves widgets untouched when the rgl payload omits them', () => {
      const id = useTerminalLayoutStore.getState().createLayout('Grid', [
        { widgetId: 'savings', x: 0, y: 0, w: 6, h: 4 },
        { widgetId: 'order-book', x: 6, y: 0, w: 4, h: 10 },
      ]);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().updateWidgetLayouts([
        { i: 'savings', x: 1, y: 1, w: 6, h: 4 },
      ]);

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        const ob = layout.widgets.find(
          (w) => w.widgetId === 'order-book',
        );
        expect(ob).toBeDefined();
        if (ob) {
          expect(ob.x).toBe(6);
          expect(ob.y).toBe(0);
        }
      }
    });
  });

  describe('toggleEditing / setEditing', () => {
    it('toggles the editing flag', () => {
      expect(useTerminalLayoutStore.getState().isEditing).toBe(false);
      useTerminalLayoutStore.getState().toggleEditing();
      expect(useTerminalLayoutStore.getState().isEditing).toBe(true);
      useTerminalLayoutStore.getState().toggleEditing();
      expect(useTerminalLayoutStore.getState().isEditing).toBe(false);
    });

    it('setEditing assigns directly', () => {
      useTerminalLayoutStore.getState().setEditing(true);
      expect(useTerminalLayoutStore.getState().isEditing).toBe(true);
      useTerminalLayoutStore.getState().setEditing(false);
      expect(useTerminalLayoutStore.getState().isEditing).toBe(false);
    });
  });

  describe('resetToDefault', () => {
    it('restores the active preset back to its canonical widget set', () => {
      // Mutate the trading preset
      useTerminalLayoutStore.setState((state) => ({
        layouts: state.layouts.map((l) =>
          l.id === PRESET_TRADING_ID
            ? { ...l, widgets: [] }
            : l,
        ),
      }));

      useTerminalLayoutStore.getState().resetToDefault();

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === PRESET_TRADING_ID);
      expect(layout).toBeDefined();
      if (layout) {
        expect(layout.widgets.length).toBeGreaterThan(0);
      }
    });

    it('is a no-op for non-preset (user) layouts', () => {
      const id = useTerminalLayoutStore.getState().createLayout('User', [
        { widgetId: 'savings', x: 0, y: 0, w: 6, h: 4 },
      ]);
      useTerminalLayoutStore.getState().setActiveLayout(id);

      useTerminalLayoutStore.getState().resetToDefault();

      const layout = useTerminalLayoutStore
        .getState()
        .layouts.find((l) => l.id === id);
      expect(layout).toBeDefined();
      if (layout) {
        // Untouched
        expect(layout.widgets).toHaveLength(1);
      }
    });
  });

  describe('persistence', () => {
    // Smoke test: persist middleware writes to localStorage. The exact
    // serialization shape is an implementation detail of zustand's persist
    // middleware, so we only assert that the configured key is written.
    it('writes to localStorage under the configured key', () => {
      useTerminalLayoutStore
        .getState()
        .renameLayout(PRESET_TRADING_ID, 'Renamed');

      const stored = memoryStorage.getItem('nomarkup-terminal-layouts');
      expect(stored).not.toBeNull();
    });
  });
});
