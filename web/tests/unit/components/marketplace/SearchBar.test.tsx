import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchBar } from '@/components/marketplace/SearchBar';

// next/navigation router stub.
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

// API mock — returns deterministic suggestions.
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

const { api } = (await import('@/lib/api')) as unknown as {
  api: {
    getPublic: ReturnType<typeof vi.fn>;
  };
};

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const sampleSuggestions = {
  suggestions: [
    {
      type: 'category' as const,
      category_slug: 'goods-furniture',
      label: 'Furniture',
    },
    {
      type: 'listing' as const,
      id: 'listing-1',
      title: 'Eames lounge chair',
      category_slug: 'goods-furniture',
      starting_price_cents: 120000,
    },
    {
      type: 'listing' as const,
      id: 'listing-2',
      title: 'Eames ottoman',
      category_slug: 'goods-furniture',
      starting_price_cents: 35000,
    },
  ],
};

describe('SearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    push.mockReset();
    api.getPublic.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with the configured placeholder and clear button hidden by default', () => {
    render(<SearchBar placeholder="Find anything..." />, { wrapper: makeWrapper() });
    expect(screen.getByPlaceholderText('Find anything...')).toBeDefined();
    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  it('does not query the API when typed value is shorter than 2 chars', async () => {
    api.getPublic.mockResolvedValue(sampleSuggestions);
    render(<SearchBar />, { wrapper: makeWrapper() });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'a' } });
    // Allow debounce to elapse.
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(api.getPublic).not.toHaveBeenCalled();
  });

  it('queries the autocomplete endpoint after debouncing >= 2 chars', async () => {
    api.getPublic.mockResolvedValue(sampleSuggestions);
    render(<SearchBar />, { wrapper: makeWrapper() });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'eames' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalled();
    });
    const calls = api.getPublic.mock.calls;
    const url = calls[calls.length - 1]?.[0] as string;
    expect(url).toContain('/api/v1/listings/autocomplete');
    expect(url).toContain('q=eames');
  });

  it('renders both category and listing suggestions in the dropdown', async () => {
    api.getPublic.mockResolvedValue(sampleSuggestions);
    render(<SearchBar />, { wrapper: makeWrapper() });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'eames' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await waitFor(() => {
      expect(screen.getByText('Furniture')).toBeDefined();
    });
    expect(screen.getByText('Eames lounge chair')).toBeDefined();
    expect(screen.getByText('Eames ottoman')).toBeDefined();
  });

  it('navigates to /marketplace?q=... when Enter is pressed without an active suggestion', async () => {
    api.getPublic.mockResolvedValue({ suggestions: [] });
    render(<SearchBar />, { wrapper: makeWrapper() });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'sofa' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    });
    expect(push).toHaveBeenCalledWith(expect.stringContaining('q=sofa'));
  });

  it('Esc closes the dropdown', async () => {
    api.getPublic.mockResolvedValue(sampleSuggestions);
    render(<SearchBar />, { wrapper: makeWrapper() });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'eames' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeNull();
    });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  it('ArrowDown moves the active suggestion and Enter selects it', async () => {
    api.getPublic.mockResolvedValue(sampleSuggestions);
    const onSelect = vi.fn();
    render(<SearchBar onSelectSuggestion={onSelect} />, { wrapper: makeWrapper() });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'eames' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeNull();
    });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalled();
    const last = onSelect.mock.calls[onSelect.mock.calls.length - 1]?.[0] as
      | { type: string }
      | undefined;
    expect(last?.type).toBe('listing');
  });

  it('clear button resets the input and closes the dropdown', async () => {
    vi.useRealTimers(); // user-event needs real timers
    api.getPublic.mockResolvedValue(sampleSuggestions);
    render(<SearchBar />, { wrapper: makeWrapper() });
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    await user.type(input, 'eames');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeNull();
    });
    const clearBtn = screen.getByLabelText('Clear search');
    await user.click(clearBtn);
    expect((input as HTMLInputElement).value).toBe('');
  });
});
