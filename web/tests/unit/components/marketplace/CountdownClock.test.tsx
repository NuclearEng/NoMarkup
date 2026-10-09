import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CountdownClock } from '@/components/marketplace/CountdownClock';

describe('CountdownClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows hours+minutes+seconds when far from end', () => {
    const endsAt = new Date('2026-04-27T13:30:45Z').toISOString();
    render(<CountdownClock endsAt={endsAt} />);
    expect(screen.getByText(/^1h 30m 45s$/)).toBeDefined();
  });

  it('shows minutes:seconds inside the hour', () => {
    const endsAt = new Date('2026-04-27T12:05:30Z').toISOString();
    render(<CountdownClock endsAt={endsAt} />);
    expect(screen.getByText('5:30')).toBeDefined();
  });

  it('shows just seconds in the final minute and applies critical styling', () => {
    const endsAt = new Date('2026-04-27T12:00:42Z').toISOString();
    const { container } = render(<CountdownClock endsAt={endsAt} />);
    expect(screen.getByText('42s')).toBeDefined();
    expect(container.querySelector('.text-red-300')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('returns "Ended" once the deadline passes', () => {
    const endsAt = new Date('2026-04-27T11:59:50Z').toISOString();
    render(<CountdownClock endsAt={endsAt} />);
    expect(screen.getByText('Ended')).toBeDefined();
  });

  it('ticks every second and re-renders the displayed seconds', () => {
    const endsAt = new Date('2026-04-27T12:00:10Z').toISOString();
    render(<CountdownClock endsAt={endsAt} />);
    expect(screen.getByText('10s')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText('8s')).toBeDefined();
  });

  it('renders an em-dash placeholder when endsAt is null', () => {
    render(<CountdownClock endsAt={null} />);
    expect(screen.getByText('—:—:—')).toBeDefined();
  });
});
