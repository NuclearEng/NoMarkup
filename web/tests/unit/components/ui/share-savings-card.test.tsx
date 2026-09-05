import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareSavingsCard } from '@/components/ui/ShareSavingsCard';

const openSpy = vi.fn();

beforeEach(() => {
  openSpy.mockClear();
  window.open = openSpy;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ShareSavingsCard', () => {
  it('renders the savings copy and category', () => {
    render(<ShareSavingsCard savingsCents={5000} jobTitle="Drywall" category="Renovation" />);
    expect(screen.getByText('I saved')).toBeDefined();
    expect(screen.getByText(/Renovation with NoMarkup/)).toBeDefined();
    expect(screen.getByText('Drywall')).toBeDefined();
  });

  it('updates the button to Copied! after the clipboard write resolves', async () => {
    // user-event v14 installs its own clipboard implementation during setup,
    // but `writeToClipboard: false` keeps it inert so the component's own
    // writeText call resolves cleanly.
    const user = userEvent.setup({ writeToClipboard: false });
    render(<ShareSavingsCard savingsCents={5000} jobTitle="X" category="Y" />);
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));
    expect(await screen.findByText('Copied!')).toBeDefined();
  });

  it('opens a Twitter share window when Share on X is clicked', async () => {
    const user = userEvent.setup();
    render(<ShareSavingsCard savingsCents={5000} jobTitle="X" category="Y" />);
    await user.click(screen.getByRole('button', { name: 'Share on X' }));
    expect(openSpy).toHaveBeenCalled();
    const callArgs = openSpy.mock.calls[0];
    expect(callArgs?.[0]).toMatch(/twitter.com\/intent\/tweet/);
    expect(String(callArgs?.[0])).toContain(encodeURIComponent('https://no-markup.com'));
    expect(String(callArgs?.[0])).not.toContain('nomarkup.com');
  });

  it('opens a Facebook share window when Share on Facebook is clicked', async () => {
    const user = userEvent.setup();
    render(<ShareSavingsCard savingsCents={5000} jobTitle="X" category="Y" />);
    await user.click(screen.getByRole('button', { name: 'Share on Facebook' }));
    expect(openSpy).toHaveBeenCalled();
    const callArgs = openSpy.mock.calls[0];
    expect(callArgs?.[0]).toMatch(/facebook.com\/sharer\/sharer\.php/);
    expect(String(callArgs?.[0])).toContain(encodeURIComponent('https://no-markup.com'));
    expect(String(callArgs?.[0])).not.toMatch(/nomarkup\.com/);
  });

  it('resets the Copy Link label after the 2s timeout', async () => {
    const user = userEvent.setup({ writeToClipboard: false });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ShareSavingsCard savingsCents={5000} jobTitle="X" category="Y" />);
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));
    await screen.findByText('Copied!');

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    await waitFor(() => {
      expect(screen.getByText('Copy Link')).toBeDefined();
    });
  });

  it('swallows clipboard write errors silently', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('not allowed'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<ShareSavingsCard savingsCents={5000} jobTitle="X" category="Y" />);
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));
    // Clipboard rejected → catch swallows → label stays "Copy Link"
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeDefined();
    expect(screen.queryByText('Copied!')).toBeNull();
  });
});
