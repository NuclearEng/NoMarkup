import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UploadOutcome } from '@/hooks/useImageUpload';

const sendMutateAsync = vi.fn<(vars: Record<string, unknown>) => Promise<unknown>>();
const proposeMutateAsync = vi.fn<(vars: Record<string, unknown>) => Promise<unknown>>();
const pendingState = { send: false, propose: false };
const uploadState: { status: string } = { status: 'idle' };
const upload = vi.fn<(file: File) => Promise<UploadOutcome>>();
const uploadOptions: unknown[] = [];

vi.mock('@/hooks/useChannels', () => ({
  useSendMessage: () => ({
    mutateAsync: sendMutateAsync,
    get isPending(): boolean {
      return pendingState.send;
    },
  }),
  useSendProposedTerms: () => ({
    mutateAsync: proposeMutateAsync,
    get isPending(): boolean {
      return pendingState.propose;
    },
  }),
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useSendTypingIndicator: () => vi.fn(),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: (options: unknown) => {
    uploadOptions.push(options);
    return { upload, status: uploadState.status, progress: 0, error: null, reset: vi.fn() };
  },
}));

vi.mock('@/components/chat/QuickReplyTemplates', () => ({
  QuickReplyTemplates: ({ onSelect }: { onSelect: (body: string) => void }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelect('On my way!');
        }}
      >
        Quick reply: on my way
      </button>
      <button
        type="button"
        onClick={() => {
          onSelect('x'.repeat(1995));
        }}
      >
        Quick reply: huge
      </button>
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

import { MessageInput } from '@/components/chat/MessageInput';
import { CHANNEL_STATUS } from '@/types';

function renderInput(props: { canProposeTerms?: boolean; channelStatus?: string } = {}) {
  return render(
    <MessageInput
      channelId="chan-1"
      channelStatus={props.channelStatus ?? CHANNEL_STATUS.ACTIVE}
      canProposeTerms={props.canProposeTerms}
    />,
  );
}

function textarea(): HTMLTextAreaElement {
  const el = screen.getByLabelText('Message input');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('message input is not a textarea');
  return el;
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!(el instanceof HTMLInputElement)) throw new Error('file input missing');
  return el;
}

function pdf(): File {
  return new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' });
}

async function choosePdf(container: HTMLElement, files: File[]): Promise<void> {
  await act(async () => {
    fireEvent.change(fileInput(container), { target: { files } });
    await Promise.resolve();
  });
}

function fillProposal(amount: string, description: string): void {
  fireEvent.click(screen.getByLabelText('Propose terms'));
  fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: description } });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadOptions.length = 0;
  pendingState.send = false;
  pendingState.propose = false;
  uploadState.status = 'idle';
  sendMutateAsync.mockResolvedValue({});
  proposeMutateAsync.mockResolvedValue({});
  upload.mockResolvedValue({ ok: true, result: { objectKey: 'k', confirmedUrl: 'https://cdn.test/quote.pdf' } });
});

describe('MessageInput quick replies', () => {
  it('inserts a quick reply at the caret and restores focus after it', async () => {
    renderInput();
    const ta = textarea();
    fireEvent.change(ta, { target: { value: 'Hi.  Thanks' } });
    ta.setSelectionRange(4, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Quick reply: on my way' }));
    expect(ta).toHaveValue('Hi. On my way! Thanks');
    await waitFor(() => {
      expect(ta).toHaveFocus();
    });
    expect(ta.selectionStart).toBe(14);
    expect(ta.selectionEnd).toBe(14);
  });

  it('replaces the selected text with the quick reply', () => {
    renderInput();
    const ta = textarea();
    fireEvent.change(ta, { target: { value: 'See you REPLACE soon' } });
    ta.setSelectionRange(8, 15);
    fireEvent.click(screen.getByRole('button', { name: 'Quick reply: on my way' }));
    expect(ta).toHaveValue('See you On my way! soon');
  });

  it('refuses a quick reply that would push the message past 2000 characters', () => {
    renderInput();
    const ta = textarea();
    fireEvent.change(ta, { target: { value: 'ten chars!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Quick reply: huge' }));
    expect(ta).toHaveValue('ten chars!');
    expect(screen.getByText('10/2000')).toBeInTheDocument();
  });
});

describe('MessageInput PDF attachment', () => {
  it('restricts the uploader to PDFs in the chat-attachment context', () => {
    renderInput();
    expect(uploadOptions[0]).toEqual({ context: 'chat_attachment', acceptedTypes: ['application/pdf'] });
  });

  it('opens the hidden file picker from the paperclip button', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {
      // jsdom has no native picker
    });
    renderInput();
    fireEvent.click(screen.getByRole('button', { name: 'Attach PDF' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('uploads the PDF then sends its URL as a file message', async () => {
    const { container } = renderInput();
    const file = pdf();
    await choosePdf(container, [file]);
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('PDF attached');
    });
    expect(upload).toHaveBeenCalledWith(file);
    expect(sendMutateAsync).toHaveBeenCalledWith({
      channelId: 'chan-1',
      input: { content: 'https://cdn.test/quote.pdf', message_type: 'file' },
    });
  });

  it('shows the upload failure reason and sends nothing', async () => {
    upload.mockResolvedValueOnce({ ok: false, error: 'Use PDF. Max 10 MB.' });
    const { container } = renderInput();
    await choosePdf(container, [pdf()]);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Use PDF. Max 10 MB.');
    });
    expect(sendMutateAsync).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows the server reason when the file message cannot be sent', async () => {
    sendMutateAsync.mockRejectedValueOnce(new Error('channel is closed'));
    const { container } = renderInput();
    await choosePdf(container, [pdf()]);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('channel is closed');
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('uses fallback copy when the send failure has no message', async () => {
    sendMutateAsync.mockRejectedValueOnce('nope');
    const { container } = renderInput();
    await choosePdf(container, [pdf()]);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to send PDF.');
    });
  });

  it('ignores an empty file selection', async () => {
    const { container } = renderInput();
    await choosePdf(container, []);
    expect(upload).not.toHaveBeenCalled();
  });

  it('ignores a file picked while another send is in flight', async () => {
    pendingState.send = true;
    const { container } = renderInput();
    expect(screen.getByRole('button', { name: 'Attach PDF' })).toBeDisabled();
    await choosePdf(container, [pdf()]);
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(['getting_url', 'uploading', 'confirming'])(
    'locks the composer while the upload is %s',
    (status) => {
      uploadState.status = status;
      renderInput();
      fireEvent.change(textarea(), { target: { value: 'ignored while busy' } });
      expect(textarea()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Attach PDF' })).toBeDisabled();
      fireEvent.keyDown(textarea(), { key: 'Enter' });
      expect(sendMutateAsync).not.toHaveBeenCalled();
    },
  );

  it('keeps the composer usable once the upload has completed', () => {
    uploadState.status = 'complete';
    renderInput();
    expect(textarea()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Attach PDF' })).toBeEnabled();
  });
});

describe('MessageInput propose terms', () => {
  it('formats the amount as USD, sends the proposal, toasts and returns to the composer', async () => {
    renderInput({ canProposeTerms: true });
    fillProposal('1250.5', 'Full repaint');
    fireEvent.click(screen.getByRole('button', { name: 'Send Proposal' }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Proposed terms sent. Waiting for customer Accept or Reject.',
      );
    });
    expect(proposeMutateAsync).toHaveBeenCalledWith({
      channelId: 'chan-1',
      input: {
        payment_type: 'completion',
        amount: '$1,250.50',
        milestones: '',
        description: 'Full repaint',
      },
    });
    expect(screen.getByLabelText('Message input')).toBeInTheDocument();
    expect(screen.queryByText('Propose Terms')).not.toBeInTheDocument();
  });

  it('keeps the form open and shows the server reason when the proposal fails', async () => {
    proposeMutateAsync.mockRejectedValueOnce(new Error('only the provider can propose terms'));
    renderInput({ canProposeTerms: true });
    fillProposal('100', 'Scope');
    fireEvent.click(screen.getByRole('button', { name: 'Send Proposal' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('only the provider can propose terms');
    });
    expect(screen.getByText('Propose Terms')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('uses fallback copy when the proposal failure has no message', async () => {
    proposeMutateAsync.mockRejectedValueOnce({ status: 500 });
    renderInput({ canProposeTerms: true });
    fillProposal('100', 'Scope');
    fireEvent.click(screen.getByRole('button', { name: 'Send Proposal' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to send proposed terms.');
    });
  });

  it('closes the proposal form from the footer Cancel button without sending', () => {
    renderInput({ canProposeTerms: true });
    fillProposal('100', 'Scope');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Message input')).toBeInTheDocument();
    expect(proposeMutateAsync).not.toHaveBeenCalled();
  });

  it('falls back to the plain composer if the viewer loses the provider capability mid-proposal', () => {
    const { rerender } = renderInput({ canProposeTerms: true });
    fireEvent.click(screen.getByLabelText('Propose terms'));
    expect(screen.getByText('Propose Terms')).toBeInTheDocument();
    rerender(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} canProposeTerms={false} />);
    expect(screen.queryByText('Propose Terms')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Propose terms')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message input')).toBeInTheDocument();
  });
});
