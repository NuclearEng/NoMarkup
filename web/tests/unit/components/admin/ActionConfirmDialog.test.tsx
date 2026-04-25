import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';

beforeAll(() => {
  // jsdom does not implement HTMLDialogElement.showModal/close — stub them
  // unconditionally so tests work whichever jsdom version is in use.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

describe('ActionConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and description when open', () => {
    render(
      createElement(ActionConfirmDialog, {
        open: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        title: 'Suspend user?',
        description: 'This will revoke all sessions.',
      }),
    );
    expect(screen.getByText('Suspend user?')).toBeDefined();
    expect(screen.getByText('This will revoke all sessions.')).toBeDefined();
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      createElement(ActionConfirmDialog, {
        open: true,
        onClose: vi.fn(),
        onConfirm,
        title: 'Title',
        description: 'Description',
        confirmLabel: 'Yes, suspend',
      }),
    );
    await user.click(screen.getByRole('button', { name: /yes, suspend/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      createElement(ActionConfirmDialog, {
        open: true,
        onClose,
        onConfirm: vi.fn(),
        title: 'Title',
        description: 'Description',
      }),
    );
    await user.click(screen.getByRole('button', { name: /cancel action/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while loading', () => {
    render(
      createElement(ActionConfirmDialog, {
        open: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        title: 'Title',
        description: 'Description',
        loading: true,
      }),
    );
    const cancel = screen.getByRole<HTMLButtonElement>('button', { name: /cancel action/i });
    expect(cancel.disabled).toBe(true);
    expect(screen.getByText(/processing/i)).toBeDefined();
  });

  it('renders custom children content', () => {
    render(
      createElement(
        ActionConfirmDialog,
        {
          open: true,
          onClose: vi.fn(),
          onConfirm: vi.fn(),
          title: 'Title',
          description: 'Description',
        },
        createElement('p', { 'data-testid': 'extra' }, 'Extra content'),
      ),
    );
    expect(screen.getByTestId('extra')).toBeDefined();
  });
});
