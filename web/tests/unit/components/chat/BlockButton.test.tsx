import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface BlockCallbacks {
  onSuccess: () => void;
}

const pending = { block: false, unblock: false };
const blockMutate = vi.fn<(vars: { userId: string; reason: string | undefined }, callbacks: BlockCallbacks) => void>();
const unblockMutate = vi.fn<(userId: string) => void>();

vi.mock('@/hooks/useUserBlocks', () => ({
  useBlockUser: () => ({
    mutate: blockMutate,
    get isPending(): boolean {
      return pending.block;
    },
  }),
  useUnblockUser: () => ({
    mutate: unblockMutate,
    get isPending(): boolean {
      return pending.unblock;
    },
  }),
}));

import { BlockButton } from '@/components/chat/BlockButton';

async function openDialog(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Block user' }));
  await screen.findByRole('dialog');
}

function confirmButton(): HTMLElement {
  // The trigger shares the accessible name "Block user" but is aria-hidden
  // behind the open dialog, so only the destructive confirm matches.
  return screen.getByRole('button', { name: 'Block user' });
}

beforeEach(() => {
  vi.clearAllMocks();
  pending.block = false;
  pending.unblock = false;
});

describe('BlockButton when already blocked', () => {
  it('shows Unblock and unblocks the user directly, without a dialog', () => {
    render(<BlockButton userId="u-2" isBlocked className="ml-2" />);
    const unblock = screen.getByRole('button', { name: 'Unblock user' });
    expect(unblock).toHaveClass('ml-2');
    expect(screen.queryByRole('button', { name: 'Block user' })).not.toBeInTheDocument();
    fireEvent.click(unblock);
    expect(unblockMutate).toHaveBeenCalledWith('u-2');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables Unblock while the request is pending', () => {
    pending.unblock = true;
    render(<BlockButton userId="u-2" isBlocked />);
    const unblock = screen.getByRole('button', { name: 'Unblock user' });
    expect(unblock).toBeDisabled();
    fireEvent.click(unblock);
    expect(unblockMutate).not.toHaveBeenCalled();
  });
});

describe('BlockButton when not blocked', () => {
  it('asks for confirmation naming the user, or generically without a name', async () => {
    const { unmount } = render(<BlockButton userId="u-2" displayName="Dana" />);
    await openDialog();
    expect(screen.getByRole('heading', { name: 'Block Dana?' })).toBeInTheDocument();
    expect(blockMutate).not.toHaveBeenCalled();
    unmount();

    render(<BlockButton userId="u-2" />);
    await openDialog();
    expect(screen.getByRole('heading', { name: 'Block this user?' })).toBeInTheDocument();
  });

  it('blocks with a trimmed reason, then closes and clears the reason', async () => {
    render(<BlockButton userId="u-2" />);
    await openDialog();
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: '  spam links  ' } });
    fireEvent.click(confirmButton());
    expect(blockMutate.mock.calls[0]?.[0]).toEqual({ userId: 'u-2', reason: 'spam links' });

    act(() => {
      blockMutate.mock.calls[0]?.[1].onSuccess();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await openDialog();
    expect(screen.getByLabelText('Reason (optional)')).toHaveValue('');
  });

  it('sends no reason when the field is blank', async () => {
    render(<BlockButton userId="u-2" />);
    await openDialog();
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: '   ' } });
    fireEvent.click(confirmButton());
    expect(blockMutate.mock.calls[0]?.[0]).toEqual({ userId: 'u-2', reason: undefined });
  });

  it('cancel closes the dialog without blocking', async () => {
    render(<BlockButton userId="u-2" />);
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(blockMutate).not.toHaveBeenCalled();
  });

  it('shows a blocking state and cannot double-submit while pending', async () => {
    const { rerender } = render(<BlockButton userId="u-2" />);
    await openDialog();
    pending.block = true;
    rerender(<BlockButton userId="u-2" />);
    const blocking = screen.getByRole('button', { name: 'Blocking…' });
    expect(blocking).toBeDisabled();
    fireEvent.click(blocking);
    expect(blockMutate).not.toHaveBeenCalled();
  });
});
