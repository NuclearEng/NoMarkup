import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ShareCallbacks {
  onSuccess: () => void;
  onError: (err: unknown) => void;
}
interface ShareVars {
  channelId: string;
  input: { phone?: string; email?: string };
}

const shareState = { isPending: false };
const mutate = vi.fn<(vars: ShareVars, callbacks: ShareCallbacks) => void>();
const reset = vi.fn();

vi.mock('@/hooks/useChannels', () => ({
  useShareContact: () => ({
    mutate,
    reset,
    get isPending(): boolean {
      return shareState.isPending;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

import { ShareContactButton } from '@/components/chat/ShareContactButton';

function callbacks(): ShareCallbacks {
  const call = mutate.mock.calls[0];
  if (!call) throw new Error('share was not submitted');
  return call[1];
}

async function openDialog(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Share contact info' }));
  await screen.findByRole('dialog');
}

function setPhone(value: string): void {
  fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value } });
}

function setEmail(value: string): void {
  fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  shareState.isPending = false;
});

describe('ShareContactButton', () => {
  it('applies a caller class to the trigger only when one is given', () => {
    const { rerender } = render(<ShareContactButton channelId="chan-1" />);
    expect(screen.getByRole('button', { name: 'Share contact info' })).not.toHaveClass('ml-auto');
    rerender(<ShareContactButton channelId="chan-1" className="ml-auto" />);
    expect(screen.getByRole('button', { name: 'Share contact info' })).toHaveClass('ml-auto');
  });

  it('requires at least one non-blank field before sharing (fail closed)', async () => {
    render(<ShareContactButton channelId="chan-1" />);
    await openDialog();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toBeDisabled();
    setPhone('   ');
    setEmail('  ');
    expect(share).toBeDisabled();
    fireEvent.click(share);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('shares only the phone when only a phone is entered, trimmed', async () => {
    render(<ShareContactButton channelId="chan-1" />);
    await openDialog();
    setPhone('  555-0100 ');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({ channelId: 'chan-1', input: { phone: '555-0100' } });
  });

  it('shares only the email when only an email is entered', async () => {
    render(<ShareContactButton channelId="chan-1" />);
    await openDialog();
    setEmail(' dana@example.com ');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      channelId: 'chan-1',
      input: { email: 'dana@example.com' },
    });
  });

  it('shares both fields, then closes, clears the form and confirms', async () => {
    render(<ShareContactButton channelId="chan-1" />);
    await openDialog();
    setPhone('555-0100');
    setEmail('dana@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      channelId: 'chan-1',
      input: { phone: '555-0100', email: 'dana@example.com' },
    });

    act(() => {
      callbacks().onSuccess();
    });
    expect(toast.success).toHaveBeenCalledWith('Contact shared in this thread.');
    expect(reset).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await openDialog();
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Email (optional)')).toHaveValue('');
  });

  it('keeps the dialog and entered values on failure and shows the reason', async () => {
    render(<ShareContactButton channelId="chan-1" />);
    await openDialog();
    setPhone('555-0100');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    act(() => {
      callbacks().onError(new Error('channel is closed'));
    });
    expect(toast.error).toHaveBeenCalledWith('channel is closed');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('555-0100');
    expect(toast.success).not.toHaveBeenCalled();

    act(() => {
      callbacks().onError(undefined);
    });
    expect(toast.error).toHaveBeenLastCalledWith('Could not share contact');
  });

  it('cancel discards the entered contact details and resets the mutation', async () => {
    render(<ShareContactButton channelId="chan-1" />);
    await openDialog();
    setPhone('555-0100');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
    await openDialog();
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('');
  });

  it('locks the whole form and shows a sharing state while pending', async () => {
    const { rerender } = render(<ShareContactButton channelId="chan-1" />);
    await openDialog();
    setPhone('555-0100');
    shareState.isPending = true;
    rerender(<ShareContactButton channelId="chan-1" />);
    const sharing = screen.getByRole('button', { name: 'Sharing…' });
    expect(sharing).toBeDisabled();
    expect(sharing).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Phone (optional)')).toBeDisabled();
    expect(screen.getByLabelText('Email (optional)')).toBeDisabled();
    fireEvent.click(sharing);
    expect(mutate).not.toHaveBeenCalled();
  });
});
