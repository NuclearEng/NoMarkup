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

  it('renders nothing when the channel has no entry in typingUsers (default fallback)', () => {
    // Selector returns undefined for the channelId — exercises the `?? []` default at line 6.
    vi.mocked(useChatStore).mockImplementation(((selector: unknown) => {
      const state = { typingUsers: {} as Record<string, string[]> } as unknown;
      return (selector as (s: unknown) => unknown)(state);
    }) as unknown as typeof useChatStore);
    const { container } = render(<TypingIndicator channelId="missing-chan" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns a STABLE empty reference so useSyncExternalStore does not loop (regression)', () => {
    // Regression: ISSUE — TypingIndicator infinite loop
    // `?? []` produced a NEW array on every selector call → useSyncExternalStore
    // saw a fresh snapshot each render → "getSnapshot should be cached" /
    // "Maximum update depth exceeded". The selector must return a referentially
    // stable value for the empty (no-one-typing) case.
    let captured: ((s: unknown) => unknown) | undefined;
    vi.mocked(useChatStore).mockImplementation(((selector: unknown) => {
      captured = selector as (s: unknown) => unknown;
      return (selector as (s: unknown) => unknown)({ typingUsers: {} });
    }) as unknown as typeof useChatStore);
    render(<TypingIndicator channelId="missing-chan" />);
    expect(captured).toBeDefined();
    const state = { typingUsers: {} as Record<string, string[]> };
    // Same state, two calls → must be the SAME reference (fails with `?? []`).
    expect(captured?.(state)).toBe(captured?.(state));
  });

  it('falls back to "Someone" label when first user entry is undefined', () => {
    // typingUsers has length but the first slot is undefined — the `?? 'Someone'`
    // default at line 10 is exercised.
    const sparseUsers = [undefined as unknown as string];
    mockTyping('chan-1', sparseUsers);
    render(<TypingIndicator channelId="chan-1" />);
    expect(screen.getByText('Someone is typing')).toBeDefined();
  });
});
