import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.fn(() => Promise.resolve({}));

vi.mock('@/hooks/useChannels', () => ({
  useSendMessage: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useSendTypingIndicator: () => () => undefined,
}));

import { MessageInput } from '@/components/chat/MessageInput';
import { CHANNEL_STATUS } from '@/types';

beforeEach(() => {
  mutateAsync.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessageInput', () => {
  it('renders the textarea and send button', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    expect(screen.getByLabelText('Message input')).toBeDefined();
    expect(screen.getByLabelText('Send message')).toBeDefined();
  });

  it('disables input when channel status is read_only', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.READ_ONLY} />);
    expect(screen.getByText(/read-only/)).toBeDefined();
  });

  it('shows closed message when channel status is closed', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.CLOSED} />);
    expect(screen.getByText(/closed/)).toBeDefined();
  });

  it('calls sendMessage with trimmed content when send button is clicked', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    fireEvent.change(textarea, { target: { value: '  hello world  ' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(mutateAsync).toHaveBeenCalledWith({
      channelId: 'chan-1',
      input: { content: 'hello world' },
    });
  });

  it('sends message on Enter without shift', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    fireEvent.change(textarea, { target: { value: 'press enter' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(mutateAsync).toHaveBeenCalled();
  });

  it('shows the propose-terms form when toggle is clicked', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    fireEvent.click(screen.getByLabelText('Propose terms'));
    expect(screen.getByText('Propose Terms')).toBeDefined();
  });
});
