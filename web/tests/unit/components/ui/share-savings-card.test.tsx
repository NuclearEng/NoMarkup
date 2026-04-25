import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareSavingsCard } from '@/components/ui/ShareSavingsCard';

const openSpy = vi.fn();

beforeEach(() => {
  openSpy.mockClear();
  window.open = openSpy;
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
  });
});
