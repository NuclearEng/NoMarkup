import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SavingsCelebration } from '@/components/ui/SavingsCelebration';

describe('SavingsCelebration', () => {
  it('renders with the savings amount and job title', () => {
    render(
      <SavingsCelebration savingsCents={12345} jobTitle="Kitchen install" onClose={vi.fn()} />,
    );
    expect(screen.getByText('Kitchen install')).toBeDefined();
    expect(screen.getByText('saved on NoMarkup')).toBeDefined();
  });

  it('exposes accessible dialog label with formatted amount', () => {
    render(
      <SavingsCelebration savingsCents={50000} jobTitle="Bath remodel" onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toContain('saved');
  });

  it('calls onClose when the overlay is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SavingsCelebration savingsCents={100} jobTitle="Job" onClose={onClose} />);
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
