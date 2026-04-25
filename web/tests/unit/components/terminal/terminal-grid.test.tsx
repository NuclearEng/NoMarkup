// TerminalGrid — orchestrates react-grid-layout + the zustand store. We mock
// react-grid-layout to a minimal pass-through and stub the store with a
// selector-aware fake. Smoke-level coverage: empty state, widget rendering,
// and edit-mode chrome (drag handle / remove button) appearing.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('react-grid-layout', () => ({
  ResponsiveGridLayout: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'rgl' }, children),
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
});
