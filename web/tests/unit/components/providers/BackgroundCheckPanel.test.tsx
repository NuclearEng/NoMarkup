import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderBackgroundCheck } from '@/hooks/useBackgroundCheck';

const flagState = { on: true };
const requestedFlags: string[] = [];
const queryEnabledArgs: boolean[] = [];
const queryState: {
  data: ProviderBackgroundCheck | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
} = { data: undefined, isLoading: false, isError: false, error: null, isFetching: false };
const refetch = vi.fn();
const startState: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};
const startMutate = vi.fn();

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: (key: string) => {
    requestedFlags.push(key);
    return flagState.on;
  },
}));

vi.mock('@/hooks/useBackgroundCheck', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useBackgroundCheck')>('@/hooks/useBackgroundCheck');
  return {
    ...actual,
    useBackgroundCheck: (enabled: boolean) => {
      queryEnabledArgs.push(enabled);
      return { ...queryState, refetch };
    },
    useStartBackgroundCheck: () => ({ ...startState, mutate: startMutate }),
  };
});

import { BackgroundCheckPanel } from '@/components/providers/BackgroundCheckPanel';
import { ApiError } from '@/lib/api';

function startButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Start background check' });
}

beforeEach(() => {
  vi.clearAllMocks();
  requestedFlags.length = 0;
  queryEnabledArgs.length = 0;
  flagState.on = true;
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.isError = false;
  queryState.error = null;
  queryState.isFetching = false;
  startState.isPending = false;
  startState.isError = false;
  startState.error = null;
});

describe('BackgroundCheckPanel gating and load states', () => {
  it('renders nothing and keeps the query disabled when the background_checks flag is off', () => {
    flagState.on = false;
    const { container } = render(<BackgroundCheckPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(requestedFlags).toEqual(['background_checks']);
    expect(queryEnabledArgs).toEqual([false]);
  });

  it('shows only the card shell while the status loads', () => {
    queryState.isLoading = true;
    render(<BackgroundCheckPanel />);
    expect(screen.getByText('Background check')).toBeInTheDocument();
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(queryEnabledArgs).toEqual([true]);
  });

  it.each([503, 401])(
    'treats a %s as "not available" — a neutral status, no retry and no start button',
    (status) => {
      queryState.isError = true;
      queryState.error = new ApiError(status, JSON.stringify({ error: 'Checkr is not configured' }));
      render(<BackgroundCheckPanel />);
      expect(screen.getByRole('status')).toHaveTextContent('Checkr is not configured');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it('shows other load failures as an alert with a working retry', () => {
    queryState.isError = true;
    queryState.error = new ApiError(500, JSON.stringify({ error: 'database unavailable' }));
    render(<BackgroundCheckPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('database unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Start background check' })).not.toBeInTheDocument();
  });

  it('uses fallback copy for a non-API failure and disables retry while refetching', () => {
    queryState.isError = true;
    queryState.error = 'weird';
    queryState.isFetching = true;
    render(<BackgroundCheckPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load background check status.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });
});

describe('BackgroundCheckPanel status and actions', () => {
  it('defaults to "Not started" with no row and lets the provider start a check', () => {
    render(<BackgroundCheckPanel />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open Checkr/ })).not.toBeInTheDocument();
    fireEvent.click(startButton());
    expect(startMutate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['CLEAR', 'Clear', false],
    ['consider', 'Consider', false],
    ['pending', 'Pending', false],
    ['complete', 'Complete (awaiting result)', false],
    ['suspended', 'Suspended', true],
    ['canceled', 'Canceled', true],
    ['cancelled', 'Canceled', true],
    ['dispute', 'Dispute', false],
    ['not_started', 'Not started', true],
    ['in_review', 'in review', false],
  ])('shows Checkr status %s as "%s" (restartable: %s)', (status, label, restartable) => {
    queryState.data = { status };
    render(<BackgroundCheckPanel />);
    expect(screen.getByText(label)).toBeInTheDocument();
    if (restartable) {
      expect(startButton()).toBeEnabled();
    } else {
      expect(startButton()).toBeDisabled();
    }
  });

  it('links to the Checkr invitation in a new tab when one exists', () => {
    queryState.data = { status: 'pending', invitation_url: 'https://apply.checkr.com/invite/abc' };
    render(<BackgroundCheckPanel />);
    const link = screen.getByRole('link', { name: /Open Checkr/ });
    expect(link).toHaveAttribute('href', 'https://apply.checkr.com/invite/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not link to a non-http invitation value', () => {
    queryState.data = { status: 'pending', invitation_url: 'javascript:alert(1)' };
    render(<BackgroundCheckPanel />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows why starting failed, with fallback copy when there is no message', () => {
    startState.isError = true;
    startState.error = new ApiError(409, JSON.stringify({ error: 'a check is already in progress' }));
    const { rerender } = render(<BackgroundCheckPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('a check is already in progress');

    startState.error = null;
    rerender(<BackgroundCheckPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start a background check.');
  });

  it('shows a starting state and locks start and refresh while the request is pending', () => {
    startState.isPending = true;
    render(<BackgroundCheckPanel />);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDisabled();
  });

  it('refreshes on demand and disables refresh while a fetch is running', () => {
    const { rerender } = render(<BackgroundCheckPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    queryState.isFetching = true;
    rerender(<BackgroundCheckPanel />);
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDisabled();
  });
});
