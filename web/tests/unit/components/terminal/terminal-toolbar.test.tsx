// TerminalToolbar — drives the layout selector dropdown, edit toggle, and
// add-widget popover. We mock the store with a selector-aware fake and
// stub `sonner` to avoid pulling in its real toast system.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn() },
}));

interface MockState {
  layouts: { id: string; name: string; widgets: { widgetId: string }[] }[];
  activeLayoutId: string;
  isEditing: boolean;
  setActiveLayout: (id: string) => void;
  createLayout: (name: string) => string;
  deleteLayout: (id: string) => void;
  renameLayout: (id: string, name: string) => void;
  duplicateLayout: (id: string) => string;
  addWidget: (id: string) => void;
  toggleEditing: () => void;
  resetToDefault: () => void;
}

const spies = {
  setActiveLayout: vi.fn<(id: string) => void>(),
  createLayout: vi.fn<(name: string) => string>(() => 'new'),
  deleteLayout: vi.fn<(id: string) => void>(),
  renameLayout: vi.fn<(id: string, name: string) => void>(),
  duplicateLayout: vi.fn<(id: string) => string>(() => 'dup'),
  addWidget: vi.fn<(id: string) => void>(),
  toggleEditing: vi.fn<() => void>(),
  resetToDefault: vi.fn<() => void>(),
};

let mockState: MockState = {
  layouts: [
    { id: 'l1', name: 'Trading Terminal', widgets: [{ widgetId: 'price-hero' }] },
    { id: 'l2', name: 'Minimal', widgets: [] },
  ],
  activeLayoutId: 'l1',
  isEditing: false,
  ...spies,
};

vi.mock('@/stores/terminal-layout-store', () => ({
  useTerminalLayoutStore: () => mockState,
}));

import { TerminalToolbar } from '@/components/terminal/terminal-toolbar';
import { TooltipProvider } from '@/components/ui/tooltip';

function renderToolbar() {
  return render(createElement(TooltipProvider, null, createElement(TerminalToolbar)));
}

describe('TerminalToolbar', () => {
  beforeEach(() => {
    Object.values(spies).forEach((fn) => { fn.mockClear(); });
    mockState = {
      layouts: [
        { id: 'l1', name: 'Trading Terminal', widgets: [{ widgetId: 'price-hero' }] },
        { id: 'l2', name: 'Minimal', widgets: [] },
      ],
      activeLayoutId: 'l1',
      isEditing: false,
      ...spies,
    };
  });

  it('shows the active layout name', () => {
    renderToolbar();
    expect(screen.getByText('Trading Terminal')).toBeDefined();
  });

  it('renders the Add Widget control', () => {
    renderToolbar();
    expect(screen.getByLabelText('Add widget to layout')).toBeDefined();
  });

  it('renders the Save control', () => {
    renderToolbar();
    expect(screen.getByLabelText('Save layout')).toBeDefined();
  });

  it('toggles edit mode when the Edit button is clicked', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const editBtn = screen.getByText('Edit').closest('button');
    expect(editBtn).not.toBeNull();
    if (editBtn) await user.click(editBtn);
    expect(spies.toggleEditing).toHaveBeenCalled();
  });

  it('shows Done label when in edit mode', () => {
    mockState = { ...mockState, isEditing: true };
    renderToolbar();
    expect(screen.getByText('Done')).toBeDefined();
  });

  it('renders the delete-layout control when more than one layout exists', () => {
    renderToolbar();
    expect(screen.getByLabelText('Delete layout')).toBeDefined();
  });

  it('hides the delete-layout control when only one layout exists', () => {
    mockState = {
      ...mockState,
      layouts: [{ id: 'l1', name: 'Only', widgets: [] }],
    };
    renderToolbar();
    expect(screen.queryByLabelText('Delete layout')).toBeNull();
  });
});
