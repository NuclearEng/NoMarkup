// TerminalGrid — orchestrates react-grid-layout + the zustand store. We mock
// react-grid-layout to a minimal pass-through and stub the store with a
// selector-aware fake. Smoke-level coverage: empty state, widget rendering,
// and edit-mode chrome (drag handle / remove button) appearing.
import { act, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

interface CapturedHandlers {
  onLayoutChange?: (
    layout: { i: string; x: number; y: number; w: number; h: number }[],
    layouts: unknown,
  ) => void;
  onDragStart?: () => void;
  onDragStop?: () => void;
  onResizeStart?: () => void;
  onResizeStop?: () => void;
}
const captured: CapturedHandlers = {};

vi.mock('react-grid-layout', () => ({
  ResponsiveGridLayout: ({
    children,
    onLayoutChange,
    onDragStart,
    onDragStop,
    onResizeStart,
    onResizeStop,
  }: {
    children: ReactNode;
    onLayoutChange?: CapturedHandlers['onLayoutChange'];
    onDragStart?: () => void;
    onDragStop?: () => void;
    onResizeStart?: () => void;
    onResizeStop?: () => void;
  }) => {
    captured.onLayoutChange = onLayoutChange;
    captured.onDragStart = onDragStart;
    captured.onDragStop = onDragStop;
    captured.onResizeStart = onResizeStart;
    captured.onResizeStop = onResizeStop;
    return createElement('div', { 'data-testid': 'rgl' }, children);
  },
  useContainerWidth: () => ({
    width: 1200,
    containerRef: { current: null },
    mounted: true,
  }),
  verticalCompactor: () => undefined,
}));

vi.mock('@/components/terminal/widget-renderer', () => ({
  WidgetRenderer: ({ widgetId }: { widgetId: string }) =>
    createElement('div', { 'data-testid': `rendered-${widgetId}` }, widgetId),
}));

interface MockState {
  layouts: { id: string; name: string; widgets: { widgetId: string; x: number; y: number; w: number; h: number }[] }[];
  activeLayoutId: string;
  isEditing: boolean;
  removeWidget: (id: string) => void;
  updateWidgetLayouts: () => void;
}

const removeWidgetSpy = vi.fn();
const updateLayoutsSpy = vi.fn();
let mockState: MockState = {
  layouts: [
    {
      id: 'l1',
      name: 'Default',
      widgets: [
        { widgetId: 'price-hero', x: 0, y: 0, w: 12, h: 4 },
        { widgetId: 'order-book', x: 0, y: 4, w: 4, h: 6 },
      ],
    },
  ],
  activeLayoutId: 'l1',
  isEditing: false,
  removeWidget: removeWidgetSpy,
  updateWidgetLayouts: updateLayoutsSpy,
};

vi.mock('@/stores/terminal-layout-store', () => ({
  useTerminalLayoutStore: () => mockState,
}));

import { TerminalGrid } from '@/components/terminal/terminal-grid';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeSim, makeMarketRange, mockProviders } from './_fixtures';

function renderGrid(props: Parameters<typeof TerminalGrid>[0]) {
  return render(createElement(TooltipProvider, null, createElement(TerminalGrid, props)));
}

const baseProps = {
  sim: makeSim(),
  auctionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
  startingPriceCents: 50000,
  marketRange: makeMarketRange(),
  mockProviders,
};

describe('TerminalGrid', () => {
  beforeEach(() => {
    removeWidgetSpy.mockReset();
    updateLayoutsSpy.mockReset();
    mockState = {
      layouts: [
        {
          id: 'l1',
          name: 'Default',
          widgets: [
            { widgetId: 'price-hero', x: 0, y: 0, w: 12, h: 4 },
            { widgetId: 'order-book', x: 0, y: 4, w: 4, h: 6 },
          ],
        },
      ],
      activeLayoutId: 'l1',
      isEditing: false,
      removeWidget: removeWidgetSpy,
      updateWidgetLayouts: updateLayoutsSpy,
    };
  });

  it('renders all widgets from the active layout', () => {
    renderGrid(baseProps);
    expect(screen.getByTestId('rendered-price-hero')).toBeDefined();
    expect(screen.getByTestId('rendered-order-book')).toBeDefined();
  });

  it('shows empty state when active layout has no widgets', () => {
    mockState = { ...mockState, layouts: [{ id: 'l1', name: 'empty', widgets: [] }] };
    renderGrid(baseProps);
    expect(screen.getByText(/No widgets added/)).toBeDefined();
  });

  it('exposes a remove button per widget in edit mode', () => {
    mockState = { ...mockState, isEditing: true };
    renderGrid(baseProps);
    const removeButtons = screen.getAllByLabelText(/Remove .* widget/);
    expect(removeButtons).toHaveLength(2);
  });

  // ---- DEEPENING TESTS ----

  it('does not persist layout changes when no drag/resize is in progress', () => {
    renderGrid(baseProps);
    // Fire a layout change without first signalling drag start. The component
    // ignores these "passive" updates from RGL itself.
    captured.onLayoutChange?.(
      [{ i: 'price-hero', x: 1, y: 1, w: 6, h: 4 }],
      {},
    );
    expect(updateLayoutsSpy).not.toHaveBeenCalled();
  });

  it('persists the new layout once a drag starts and the layout changes', () => {
    renderGrid(baseProps);
    act(() => {
      captured.onDragStart?.();
    });
    act(() => {
      captured.onLayoutChange?.(
        [
          { i: 'price-hero', x: 0, y: 0, w: 12, h: 4 },
          { i: 'order-book', x: 6, y: 4, w: 4, h: 6 },
        ],
        {},
      );
    });
    expect(updateLayoutsSpy).toHaveBeenCalledTimes(1);
    const [arg] = updateLayoutsSpy.mock.calls[0] as [
      { i: string; x: number; y: number; w: number; h: number }[],
    ];
    expect(arg).toHaveLength(2);
    expect(arg[0]?.i).toBe('price-hero');
    expect(arg[1]?.x).toBe(6);
  });

  it('stops persisting layout changes after the drag ends', () => {
    renderGrid(baseProps);
    act(() => {
      captured.onDragStart?.();
    });
    act(() => {
      captured.onDragStop?.();
    });
    act(() => {
      captured.onLayoutChange?.([], {});
    });
    expect(updateLayoutsSpy).not.toHaveBeenCalled();
  });

  it('persists layout changes during a resize and stops after resize ends', () => {
    renderGrid(baseProps);
    act(() => {
      captured.onResizeStart?.();
    });
    act(() => {
      captured.onLayoutChange?.(
        [{ i: 'price-hero', x: 0, y: 0, w: 8, h: 6 }],
        {},
      );
    });
    expect(updateLayoutsSpy).toHaveBeenCalledTimes(1);
    act(() => {
      captured.onResizeStop?.();
    });
    act(() => {
      captured.onLayoutChange?.(
        [{ i: 'price-hero', x: 0, y: 0, w: 9, h: 6 }],
        {},
      );
    });
    // Still 1 — the post-stop update is ignored.
    expect(updateLayoutsSpy).toHaveBeenCalledTimes(1);
  });

  it('removes a widget when the in-edit-mode remove button is clicked', () => {
    mockState = { ...mockState, isEditing: true };
    renderGrid(baseProps);
    const [first] = screen.getAllByLabelText(/Remove .* widget/);
    expect(first).toBeDefined();
    first?.click();
    expect(removeWidgetSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to widget id when the widget definition is missing from the registry', () => {
    mockState = {
      ...mockState,
      isEditing: true,
      layouts: [
        {
          id: 'l1',
          name: 'Default',
          widgets: [{ widgetId: 'this-id-is-not-in-the-registry', x: 0, y: 0, w: 4, h: 3 }],
        },
      ],
    };
    renderGrid(baseProps);
    // The aria-label uses the id when def?.label is undefined.
    expect(screen.getByLabelText('Remove this-id-is-not-in-the-registry widget')).toBeDefined();
  });

  it('handles a missing active layout (no widgets) without rendering rgl', () => {
    mockState = {
      ...mockState,
      activeLayoutId: 'does-not-exist',
    };
    renderGrid(baseProps);
    // Empty-state copy from the ?? [] fallback path
    expect(screen.getByText(/No widgets added/)).toBeDefined();
  });
});
