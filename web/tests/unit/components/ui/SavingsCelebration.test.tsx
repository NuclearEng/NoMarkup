import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SavingsCelebration } from '@/components/ui/SavingsCelebration';

describe('SavingsCelebration (ui)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the savings amount and job title after the next animation frame', () => {
    render(
      <SavingsCelebration savingsCents={5000} jobTitle="Bathroom remodel" onClose={vi.fn()} />,
    );
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText('Bathroom remodel')).toBeTruthy();
    expect(screen.getByText(/saved on NoMarkup/)).toBeTruthy();
  });

  it('fires onClose after the 5-second auto-dismiss timer', () => {
    const onClose = vi.fn();
    render(
      <SavingsCelebration savingsCents={1000} jobTitle="Job A" onClose={onClose} />,
    );
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <SavingsCelebration savingsCents={1000} jobTitle="Job B" onClose={onClose} />,
    );
    act(() => {
      vi.runAllTimers();
    });
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onClose when Escape is pressed on the overlay', () => {
    const onClose = vi.fn();
    render(
      <SavingsCelebration savingsCents={1000} jobTitle="Job C" onClose={onClose} />,
    );
    act(() => {
      vi.runAllTimers();
    });
    const overlay = screen.getByRole('dialog');
    fireEvent.keyDown(overlay, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not fire onClose for non-Escape keys', () => {
    const onClose = vi.fn();
    render(
      <SavingsCelebration savingsCents={1000} jobTitle="Job D" onClose={onClose} />,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const overlay = screen.getByRole('dialog');
    fireEvent.keyDown(overlay, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears the timer on unmount so onClose is never called after teardown', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <SavingsCelebration savingsCents={1000} jobTitle="Job E" onClose={onClose} />,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
