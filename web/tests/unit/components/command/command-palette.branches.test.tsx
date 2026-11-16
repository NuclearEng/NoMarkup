import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const authState: { isAuthenticated: boolean; user: { id: string; roles: string[] } | null } = {
  isAuthenticated: false,
  user: null,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/lib/api', () => ({
  api: { getPublic: vi.fn() },
}));

import { CommandPalette, CommandPaletteTrigger } from '@/components/command/command-palette';
import { api } from '@/lib/api';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function pressModK(init: KeyboardEventInit): void {
  act(() => {
    fireEvent.keyDown(window, init);
  });
}

async function openPalette(): Promise<HTMLElement> {
  pressModK({ key: 'k', metaKey: true });
  return screen.findByPlaceholderText('Jump to…');
}

function optionLabels(): string[] {
  return screen.getAllByRole('option').map((o) => o.querySelector('.font-medium')?.textContent ?? '');
}

function activeLabel(): string | undefined {
  return screen
    .getAllByRole('option')
    .find((o) => o.getAttribute('aria-selected') === 'true')
    ?.querySelector('.font-medium')?.textContent;
}

function type(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.isAuthenticated = false;
  authState.user = null;
  vi.mocked(api.getPublic).mockResolvedValue({});
});

describe('CommandPalette role-aware commands', () => {
  it('offers only public destinations and Sign in to a signed-out visitor', async () => {
    render(<CommandPalette />);
    await openPalette();
    expect(optionLabels()).toEqual(['Browse jobs', 'Marketplace', 'Sign in']);
  });

  it('hides Sign in and the provider workspace from a signed-in customer', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'u1', roles: ['customer'] };
    render(<CommandPalette />);
    await openPalette();
    const labels = optionLabels();
    expect(labels).toContain('Post a job');
    expect(labels).toContain('Settings');
    expect(labels).not.toContain('Sign in');
    expect(labels).not.toContain('Provider workspace');
  });

  it('adds the provider workspace for providers', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'u1', roles: ['customer', 'provider'] };
    render(<CommandPalette />);
    await openPalette();
    expect(optionLabels()).toContain('Provider workspace');
  });

  it('shows a hint line only for commands that have one', async () => {
    render(<CommandPalette />);
    await openPalette();
    expect(screen.getByRole('option', { name: /Browse jobs/ })).toHaveTextContent('Find work to bid');
    expect(screen.getByRole('option', { name: /Sign in/ })).toHaveTextContent(/^Sign in$/);
  });
});

describe('CommandPalette open / close', () => {
  it('ignores a bare "k" and toggles closed again on Ctrl+K', async () => {
    render(<CommandPalette />);
    pressModK({ key: 'k' });
    expect(screen.queryByPlaceholderText('Jump to…')).not.toBeInTheDocument();

    pressModK({ key: 'K', ctrlKey: true });
    expect(await screen.findByPlaceholderText('Jump to…')).toBeInTheDocument();

    pressModK({ key: 'k', ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Jump to…')).not.toBeInTheDocument();
    });
  });

  it('clears the previous query when reopened', async () => {
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'market');
    expect(input).toHaveValue('market');
    pressModK({ key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Jump to…')).not.toBeInTheDocument();
    });
    expect(await openPalette()).toHaveValue('');
  });

  it('opens from the header trigger button', async () => {
    render(
      <>
        <CommandPalette />
        <CommandPaletteTrigger className="ml-2" />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open command palette' });
    expect(trigger).toHaveClass('ml-2');
    fireEvent.click(trigger);
    expect(await screen.findByPlaceholderText('Jump to…')).toBeInTheDocument();
  });
});

describe('CommandPalette filtering and keyboard navigation', () => {
  it('matches on keywords as well as labels', async () => {
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'goods');
    expect(optionLabels()).toEqual(['Marketplace']);
    type(input, 'AUTH');
    expect(optionLabels()).toEqual(['Sign in']);
  });

  it('shows "No matches" and makes arrows and Enter no-ops when nothing matches', async () => {
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'q');
    type(input, 'zzzzqq');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('wraps the selection in both directions and opens the active command', async () => {
    render(<CommandPalette />);
    const input = await openPalette();
    expect(activeLabel()).toBe('Browse jobs');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeLabel()).toBe('Sign in');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeLabel()).toBe('Browse jobs');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeLabel()).toBe('Marketplace');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(activeLabel()).toBe('Marketplace');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/marketplace');
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Jump to…')).not.toBeInTheDocument();
    });
  });

  it('follows the pointer and navigates on click', async () => {
    render(<CommandPalette />);
    await openPalette();
    const signIn = screen.getByRole('button', { name: /Sign in/ });
    fireEvent.mouseEnter(signIn);
    expect(activeLabel()).toBe('Sign in');
    fireEvent.click(signIn);
    expect(push).toHaveBeenCalledWith('/login');
  });
});

describe('CommandPalette live results', () => {
  it('does not search the catalog for a single character', async () => {
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'm');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(api.getPublic).not.toHaveBeenCalled();
  });

  it('turns a pasted UUID into direct job and listing jumps without hitting the API', async () => {
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, `  ${UUID}  `);
    expect(optionLabels()).toEqual(['Open job 3f2504e0…', 'Open listing 3f2504e0…']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith(`/marketplace/${UUID}`);
    expect(api.getPublic).not.toHaveBeenCalled();
  });

  it('lists matching jobs and listings ahead of static commands, with fallbacks for untitled rows', async () => {
    vi.mocked(api.getPublic).mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/api/v1/jobs')
          ? { jobs: [{ id: 'j1', title: 'Fix roof & gutters' }, { id: 'j2', title: '' }] }
          : { listings: [{ id: 'l1', title: 'Roof rack' }, { id: 'l2', title: '' }] },
      ),
    );
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'roof & co');

    expect(await screen.findByRole('option', { name: /Fix roof & gutters/ })).toBeInTheDocument();
    expect(api.getPublic).toHaveBeenCalledWith('/api/v1/jobs?q=roof%20%26%20co&page_size=5');
    expect(api.getPublic).toHaveBeenCalledWith('/api/v1/listings?q=roof%20%26%20co&page_size=5');
    expect(optionLabels()).toEqual(['Fix roof & gutters', 'Job', 'Roof rack', 'Listing']);
    expect(screen.getByRole('option', { name: /Roof rack/ })).toHaveTextContent('Goods auction');

    fireEvent.click(screen.getByRole('button', { name: /Roof rack/ }));
    expect(push).toHaveBeenCalledWith('/marketplace/l1');
  });

  it('still shows job hits when the listings search fails or returns no array', async () => {
    vi.mocked(api.getPublic).mockImplementation((path: string) =>
      path.startsWith('/api/v1/jobs')
        ? Promise.resolve({ jobs: [{ id: 'j1', title: 'Paint fence' }] })
        : Promise.reject(new Error('503')),
    );
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'fence');
    expect(await screen.findByRole('option', { name: /Paint fence/ })).toBeInTheDocument();
    expect(optionLabels()).toEqual(['Paint fence']);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/jobs/j1');
  });

  it('degrades to static commands when both searches fail', async () => {
    vi.mocked(api.getPublic).mockRejectedValue(new Error('offline'));
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'market');
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalledTimes(2);
    });
    expect(optionLabels()).toEqual(['Browse jobs', 'Marketplace']);
  });

  it('only searches for the latest query when typing continues inside the debounce window', async () => {
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'ro');
    type(input, 'roof');
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalledTimes(2);
    });
    expect(api.getPublic).not.toHaveBeenCalledWith('/api/v1/jobs?q=ro&page_size=5');
    expect(api.getPublic).toHaveBeenCalledWith('/api/v1/jobs?q=roof&page_size=5');
  });

  it('drops a response that arrives after the query has changed', async () => {
    let release: (value: unknown) => void = () => undefined;
    vi.mocked(api.getPublic).mockImplementation((path: string) =>
      path.includes('q=stale')
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({}),
    );
    render(<CommandPalette />);
    const input = await openPalette();
    type(input, 'stale');
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalledWith('/api/v1/listings?q=stale&page_size=5');
    });
    type(input, 'zzzzqq');
    await act(async () => {
      release({ jobs: [{ id: 'j9', title: 'Stale job' }], listings: [{ id: 'l9', title: 'Stale listing' }] });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalledWith('/api/v1/jobs?q=zzzzqq&page_size=5');
    });
    expect(screen.queryByText('Stale job')).not.toBeInTheDocument();
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });
});
