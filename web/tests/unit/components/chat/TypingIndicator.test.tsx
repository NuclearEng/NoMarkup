import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/chat-store', () => ({
  useChatStore: vi.fn(),
}));

import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { useChatStore } from '@/stores/chat-store';

afterEach(() => {
  vi.clearAllMocks();
});

function mockTyping(channelId: string, users: string[]) {
  vi.mocked(useChatStore).mockImplementation(((selector: unknown) => {
    const state = { typingUsers: { [channelId]: users } } as unknown;
    return (selector as (s: unknown) => unknown)(state);
  }) as unknown as typeof useChatStore);
}

describe('TypingIndicator', () => {
  it('renders nothing when no one is typing', () => {
    mockTyping('chan-1', []);
    const { container } = render(<TypingIndicator channelId="chan-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders single-user message when one user is typing', () => {
    mockTyping('chan-1', ['alice']);
    render(<TypingIndicator channelId="chan-1" />);
    expect(screen.getByText('alice is typing')).toBeDefined();
  });

  it('renders multi-user message when multiple users are typing', () => {
    mockTyping('chan-1', ['alice', 'bob', 'carol']);
    render(<TypingIndicator channelId="chan-1" />);
    expect(screen.getByText('3 people are typing')).toBeDefined();
  });

  it('uses aria-live polite for the announcement', () => {
    mockTyping('chan-1', ['alice']);
    const { container } = render(<TypingIndicator channelId="chan-1" />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeDefined();
  });
});
