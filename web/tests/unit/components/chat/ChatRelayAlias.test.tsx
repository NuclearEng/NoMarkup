import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatAlias, CreateChatAliasInput } from '@/types';

const authState = { isAuthenticated: true };
const aliasesState: {
  data: { aliases: ChatAlias[]; twilio_configured: boolean } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };
const refetch = vi.fn();
const createState = { isPending: false };
const createMutateAsync = vi.fn<(input: CreateChatAliasInput) => Promise<unknown>>();
const aliasesEnabledArgs: boolean[] = [];
const writeText = vi.fn<(value: string) => Promise<void>>();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) => selector(authState),
}));

vi.mock('@/hooks/useChatRelay', () => ({
  useChatAliases: (enabled: boolean) => {
    aliasesEnabledArgs.push(enabled);
    return { ...aliasesState, refetch };
  },
  useCreateChatAlias: () => ({
    mutateAsync: createMutateAsync,
    get isPending(): boolean {
      return createState.isPending;
    },
  }),
}));

import { ChatRelayAlias } from '@/components/chat/ChatRelayAlias';

function alias(overrides: Partial<ChatAlias>): ChatAlias {
  return {
    id: 'al-1',
    user_id: 'u-1',
    context_type: 'job',
    context_id: 'job-1',
    email_alias: 'relay-abc@relay.test',
    twilio_proxy_phone: null,
    created_at: '2026-01-01T00:00:00Z',
    expires_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  aliasesEnabledArgs.length = 0;
  authState.isAuthenticated = true;
  aliasesState.data = { aliases: [], twilio_configured: false };
  aliasesState.isLoading = false;
  aliasesState.isError = false;
  createState.isPending = false;
  createMutateAsync.mockResolvedValue({});
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('ChatRelayAlias', () => {
  it('renders nothing and keeps the query disabled for signed-out visitors', () => {
    authState.isAuthenticated = false;
    const { container } = render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(aliasesEnabledArgs).toEqual([false]);
  });

  it('shows only a loading status while aliases load', () => {
    aliasesState.data = undefined;
    aliasesState.isLoading = true;
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading relay address…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(aliasesEnabledArgs).toEqual([true]);
  });

  it('shows an error with a retry that refetches, and no create button', () => {
    aliasesState.data = undefined;
    aliasesState.isError = true;
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your relay address.');
    expect(screen.queryByRole('button', { name: 'Create relay address' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('offers to create an alias when none matches this exact context', () => {
    aliasesState.data = {
      aliases: [
        alias({ id: 'a', context_type: 'listing', context_id: 'job-1', email_alias: 'wrong-type@relay.test' }),
        alias({ id: 'b', context_type: 'job', context_id: 'job-2', email_alias: 'wrong-id@relay.test' }),
      ],
      twilio_configured: false,
    };
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    expect(screen.queryByTestId('chat-relay-email')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create relay address' })).toBeEnabled();
  });

  it('creates an alias for the current context', async () => {
    render(<ChatRelayAlias contextType="listing" contextId="l-9" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create relay address' }));
    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({ context_type: 'listing', context_id: 'l-9' });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the create button while the request is pending', () => {
    createState.isPending = true;
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    expect(screen.getByRole('button', { name: 'Creating relay…' })).toBeDisabled();
  });

  it('shows the failure reason when creation fails, and clears it on retry', async () => {
    createMutateAsync.mockRejectedValueOnce(new Error('rate limited'));
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create relay address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('rate limited');

    fireEvent.click(screen.getByRole('button', { name: 'Create relay address' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('uses fallback copy when creation fails without a message', async () => {
    createMutateAsync.mockRejectedValueOnce('boom');
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create relay address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create a relay address. Try again.',
    );
  });

  it('shows the matching relay email, hides the phone row when no proxy number exists', () => {
    aliasesState.data = {
      aliases: [alias({ twilio_proxy_phone: '   ' })],
      twilio_configured: false,
    };
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    expect(screen.getByTestId('chat-relay-email')).toHaveTextContent('relay-abc@relay.test');
    expect(screen.queryByText(/\+1/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create relay address' })).not.toBeInTheDocument();
  });

  it('shows the trimmed proxy phone when one is assigned', () => {
    aliasesState.data = {
      aliases: [alias({ twilio_proxy_phone: ' +1 555 0100 ' })],
      twilio_configured: true,
    };
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    expect(screen.getByText('+1 555 0100')).toBeInTheDocument();
  });

  it('copies the relay email and confirms', async () => {
    aliasesState.data = { aliases: [alias({})], twilio_configured: false };
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy relay email' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('relay-abc@relay.test');
  });

  it('tells the user to copy manually when the clipboard is blocked', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    aliasesState.data = { aliases: [alias({})], twilio_configured: false };
    render(<ChatRelayAlias contextType="job" contextId="job-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy relay email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not copy. Select the address and copy it manually.',
    );
    expect(screen.getByRole('button', { name: 'Copy relay email' })).toBeInTheDocument();
  });
});
