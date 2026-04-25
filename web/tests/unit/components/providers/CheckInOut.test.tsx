import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckInOut } from '@/components/providers/CheckInOut';

const checkInMutate = vi.fn();
const checkOutMutate = vi.fn();

vi.mock('@/hooks/useWorkspace', () => ({
  WORK_SESSION_STATUS: {
    NOT_STARTED: 'not_started',
    CHECKED_IN: 'checked_in',
    CHECKED_OUT: 'checked_out',
  },
  useWorkSession: vi.fn(() => ({ data: null, isLoading: false })),
  useCheckIn: () => ({ mutate: checkInMutate, isPending: false }),
  useCheckOut: () => ({ mutate: checkOutMutate, isPending: false }),
}));

const { useWorkSession } = await import('@/hooks/useWorkspace');

describe('CheckInOut', () => {
  beforeEach(() => {
    checkInMutate.mockReset();
    checkOutMutate.mockReset();
    vi.mocked(useWorkSession).mockReturnValue({
      data: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkSession>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Check In button when no session is active', () => {
    render(<CheckInOut contractId="c-1" />);
    expect(screen.getByRole('button', { name: /Check in to this job/ })).toBeDefined();
  });

  it('renders skeleton in loading state', () => {
    vi.mocked(useWorkSession).mockReturnValue({
      data: null,
      isLoading: true,
    } as unknown as ReturnType<typeof useWorkSession>);
    const { container } = render(<CheckInOut contractId="c-1" />);
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('calls checkIn.mutate when Check In is pressed', async () => {
    const user = userEvent.setup();
    render(<CheckInOut contractId="c-1" />);
    await user.click(screen.getByRole('button', { name: /Check in to this job/ }));
    expect(checkInMutate).toHaveBeenCalled();
  });

  it('renders the Check Out button when checked in', () => {
    vi.mocked(useWorkSession).mockReturnValue({
      data: {
        status: 'checked_in',
        checked_in_at: '2026-04-23T15:00:00Z',
        checked_out_at: null,
        duration_minutes: null,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkSession>);
    render(<CheckInOut contractId="c-1" />);
    expect(screen.getByRole('button', { name: /Check out from this job/ })).toBeDefined();
    expect(screen.getByText('Checked in')).toBeDefined();
  });

  it('calls checkOut.mutate when Check Out is pressed', async () => {
    vi.mocked(useWorkSession).mockReturnValue({
      data: {
        status: 'checked_in',
        checked_in_at: '2026-04-23T15:00:00Z',
        checked_out_at: null,
        duration_minutes: null,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkSession>);
    const user = userEvent.setup();
    render(<CheckInOut contractId="c-1" />);
    await user.click(screen.getByRole('button', { name: /Check out from this job/ }));
    expect(checkOutMutate).toHaveBeenCalled();
  });

  it('shows complete state when checked out with duration', () => {
    vi.mocked(useWorkSession).mockReturnValue({
      data: {
        status: 'checked_out',
        checked_in_at: '2026-04-23T15:00:00Z',
        checked_out_at: '2026-04-23T17:30:00Z',
        duration_minutes: 150,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkSession>);
    render(<CheckInOut contractId="c-1" />);
    expect(screen.getByText('Work session complete')).toBeDefined();
    expect(screen.getByText(/2h 30m/)).toBeDefined();
  });
});
