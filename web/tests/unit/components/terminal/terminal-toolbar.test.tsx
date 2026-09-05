// TerminalToolbar — drives the layout selector dropdown, edit toggle, and
// add-widget popover. We mock the store with a selector-aware fake and
// stub `sonner` to avoid pulling in its real toast system.
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
}));
const { success: toastSuccess, info: toastInfo } = toastMocks;
vi.mock('sonner', () => ({
  toast: toastMocks,
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
    toastSuccess.mockClear();
    toastInfo.mockClear();
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

  it('shows a success toast when Save is clicked', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Save layout'));
    expect(toastSuccess).toHaveBeenCalledWith('Saved!', { duration: 1500 });
  });

  it('opens the rename input when the rename pencil is clicked', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Rename layout'));
    const input = await screen.findByLabelText('Layout name');
    expect((input as HTMLInputElement).value).toBe('Trading Terminal');
  });

  it('commits a rename on Enter and clears editing state', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Rename layout'));
    const input = await screen.findByLabelText('Layout name');
    await user.clear(input);
    await user.type(input, 'My Layout');
    await user.keyboard('{Enter}');
    expect(spies.renameLayout).toHaveBeenCalledWith('l1', 'My Layout');
    await waitFor(() => {
      expect(screen.queryByLabelText('Layout name')).toBeNull();
    });
  });

  it('cancels rename on Escape without invoking renameLayout', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Rename layout'));
    const input = await screen.findByLabelText('Layout name');
    await user.type(input, 'Discarded');
    await user.keyboard('{Escape}');
    expect(spies.renameLayout).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByLabelText('Layout name')).toBeNull();
    });
  });

  it('does not rename when the input is whitespace-only on blur', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Rename layout'));
    const input = await screen.findByLabelText('Layout name');
    await user.clear(input);
    await user.type(input, '   ');
    act(() => { input.blur(); });
    await waitFor(() => {
      expect(screen.queryByLabelText('Layout name')).toBeNull();
    });
    expect(spies.renameLayout).not.toHaveBeenCalled();
  });

  it('opens the reset-confirmation popover and resets on confirm', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Reset layout to default'));
    const confirmButton = await screen.findByRole('button', { name: /^reset$/i });
    await user.click(confirmButton);
    expect(spies.resetToDefault).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith('Layout reset to default');
  });

  it('cancels the reset confirmation without invoking resetToDefault', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Reset layout to default'));
    const cancelButton = await screen.findByRole('button', { name: /cancel/i });
    await user.click(cancelButton);
    expect(spies.resetToDefault).not.toHaveBeenCalled();
  });

  it('opens the delete-confirmation popover and deletes on confirm', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Delete layout'));
    const confirmButton = await screen.findByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);
    expect(spies.deleteLayout).toHaveBeenCalledWith('l1');
    expect(toastSuccess).toHaveBeenCalledWith('"Trading Terminal" deleted');
  });

  it('cancels the delete confirmation without invoking deleteLayout', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Delete layout'));
    const cancelButton = await screen.findByRole('button', { name: /cancel/i });
    await user.click(cancelButton);
    expect(spies.deleteLayout).not.toHaveBeenCalled();
  });

  it('opens the layout selector and switches active layout', async () => {
    const user = userEvent.setup();
    renderToolbar();
    // Trigger button shows the active layout name
    const trigger = screen.getByText('Trading Terminal').closest('button');
    expect(trigger).not.toBeNull();
    if (trigger) await user.click(trigger);
    const minimalItem = await screen.findByText('Minimal');
    await user.click(minimalItem);
    expect(spies.setActiveLayout).toHaveBeenCalledWith('l2');
  });

  it('creates a new layout from the selector menu', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByText('Trading Terminal').closest('button');
    if (trigger) await user.click(trigger);
    const newLayout = await screen.findByText(/New Layout/i);
    await user.click(newLayout);
    expect(spies.createLayout).toHaveBeenCalledWith('Layout 3');
  });

  it('duplicates the active layout from the selector menu', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByText('Trading Terminal').closest('button');
    if (trigger) await user.click(trigger);
    const dup = await screen.findByText(/Duplicate Current/i);
    await user.click(dup);
    expect(spies.duplicateLayout).toHaveBeenCalledWith('l1');
  });

  it('opens the Add Widget popover and invokes addWidget for an inactive widget', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Add widget to layout'));
    // "Savings Hero" is inactive in our mock state (only price-hero is present)
    const inactiveWidget = await screen.findByText('Savings Hero');
    const button = inactiveWidget.closest('button');
    expect(button).not.toBeNull();
    expect(button?.hasAttribute('disabled')).toBe(false);
    if (button) await user.click(button);
    expect(spies.addWidget).toHaveBeenCalledWith('savings');
  });

  it('does not invoke addWidget for a widget already in the layout', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Add widget to layout'));
    // The "Active" badge marks widgets already present; their buttons are disabled.
    const activeBadge = await screen.findByText('Active');
    const activeButton = activeBadge.closest('button');
    expect(activeButton?.hasAttribute('disabled')).toBe(true);
  });

  it('hides the Reset confirmation when the popover Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Reset layout to default'));
    expect(screen.getByText(/Reset this layout/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Reset this layout/i)).toBeNull();
    });
  });
});
