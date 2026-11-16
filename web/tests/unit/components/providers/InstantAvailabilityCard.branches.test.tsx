import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProfileLike {
  id: string;
  instant_enabled: boolean;
  instant_available: boolean;
  schedule?: { day: string; start_time: string; end_time: string }[];
}

const profileState: { data: ProfileLike | null | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const availabilityState = { isPending: false };
const mutateAsync = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => profileState,
  useSetAvailability: () => ({
    mutateAsync,
    get isPending(): boolean {
      return availabilityState.isPending;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

import { InstantAvailabilityCard } from '@/components/providers/InstantAvailabilityCard';

let client: QueryClient;

function renderCard(className?: string) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<InstantAvailabilityCard className={className} />, { wrapper: Wrapper });
}

function profile(overrides: Partial<ProfileLike> = {}): ProfileLike {
  return { id: 'prof-1', instant_enabled: false, instant_available: false, schedule: [], ...overrides };
}

function daySwitch(day: string): HTMLElement {
  return screen.getByRole('switch', { name: `${day} available` });
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save weekly schedule' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  profileState.data = profile();
  profileState.isLoading = false;
  availabilityState.isPending = false;
  mutateAsync.mockResolvedValue({});
});

describe('InstantAvailabilityCard load states', () => {
  it('shows a labelled skeleton while the profile loads', () => {
    profileState.data = undefined;
    profileState.isLoading = true;
    renderCard('mt-6');
    const status = screen.getByRole('status', { name: 'Loading Instant availability' });
    expect(status).toHaveClass('mt-6');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('renders nothing when the user has no provider profile', () => {
    profileState.data = null;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('explains how the program gets enabled when it is not yet on', () => {
    renderCard();
    expect(screen.getByText(/Program enables when you go live or save a schedule\./)).toBeInTheDocument();
    expect(screen.getByText('No days set')).toBeInTheDocument();
  });

  it('confirms when the Instant program is already enabled', () => {
    profileState.data = profile({ instant_enabled: true, instant_available: true });
    renderCard();
    expect(screen.getByText(/Instant program enabled\./)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Available now for Instant match' })).toBeChecked();
  });

  it('re-requests the profile once when the schedule key is missing, still syncing available-now', () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    profileState.data = { id: 'prof-1', instant_enabled: true, instant_available: true };
    const { rerender } = renderCard();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['providerProfile'] });
    expect(screen.getByRole('switch', { name: 'Available now for Instant match' })).toBeChecked();

    profileState.data = { id: 'prof-1', instant_enabled: true, instant_available: false };
    rerender(<InstantAvailabilityCard />);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch', { name: 'Available now for Instant match' })).not.toBeChecked();
  });
});

describe('InstantAvailabilityCard schedule hydration', () => {
  it('normalises day codes and skips unknown days and incomplete windows', () => {
    profileState.data = profile({
      schedule: [
        { day: ' WED ', start_time: ' 10:00 ', end_time: '14:00' },
        { day: 'funday', start_time: '01:00', end_time: '02:00' },
        { day: 'fri', start_time: '', end_time: '11:00' },
        { day: 'sat', start_time: '09:00', end_time: '  ' },
      ],
    });
    renderCard();
    expect(daySwitch('Wednesday')).toBeChecked();
    expect(daySwitch('Friday')).not.toBeChecked();
    expect(daySwitch('Saturday')).not.toBeChecked();
    expect(screen.getByLabelText('Wednesday start')).toHaveValue('10:00');
    expect(screen.getByText('1 day')).toBeInTheDocument();
  });

  it('pluralises the enabled-day count', () => {
    profileState.data = profile({
      schedule: [
        { day: 'mon', start_time: '09:00', end_time: '17:00' },
        { day: 'tue', start_time: '09:00', end_time: '17:00' },
      ],
    });
    renderCard();
    expect(screen.getByText('2 days')).toBeInTheDocument();
  });
});

describe('InstantAvailabilityCard saving', () => {
  it('reveals default hours when a day is switched on and saves the edited window', async () => {
    renderCard();
    expect(screen.queryByLabelText('Monday start')).not.toBeInTheDocument();
    fireEvent.click(daySwitch('Monday'));
    expect(screen.getByLabelText('Monday start')).toHaveValue('09:00');
    expect(screen.getByLabelText('Monday end')).toHaveValue('17:00');

    fireEvent.change(screen.getByLabelText('Monday start'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('Monday end'), { target: { value: '12:30' } });
    save();

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Weekly Instant schedule saved');
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      enabled: true,
      available_now: false,
      schedule: [{ day: 'mon', start_time: '08:00', end_time: '12:30' }],
    });
  });

  it('hides the hours again when a day is switched off', () => {
    profileState.data = profile({ schedule: [{ day: 'mon', start_time: '09:00', end_time: '17:00' }] });
    renderCard();
    fireEvent.click(daySwitch('Monday'));
    expect(screen.queryByLabelText('Monday start')).not.toBeInTheDocument();
    expect(screen.getByText('No days set')).toBeInTheDocument();
  });

  it('saves an empty schedule without enabling the program for a provider who never opted in', async () => {
    renderCard();
    save();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Instant availability updated');
    });
    expect(mutateAsync).toHaveBeenCalledWith({ enabled: false, available_now: false, schedule: [] });
  });

  it('keeps the program enabled when an already-enrolled provider clears the schedule', async () => {
    profileState.data = profile({ instant_enabled: true });
    renderCard();
    save();
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ enabled: true, available_now: false, schedule: [] });
    });
  });

  it('goes available-now immediately, re-sending the saved windows so they are not wiped', async () => {
    profileState.data = profile({ schedule: [{ day: 'fri', start_time: '09:00', end_time: '11:00' }] });
    renderCard();
    fireEvent.click(screen.getByRole('switch', { name: 'Available now for Instant match' }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('You are available for Instant match');
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      enabled: true,
      available_now: true,
      schedule: [{ day: 'fri', start_time: '09:00', end_time: '11:00' }],
    });
    expect(screen.getByRole('switch', { name: 'Available now for Instant match' })).toBeChecked();
  });

  it('blocks a window whose end is not after its start and names the day', async () => {
    renderCard();
    fireEvent.click(daySwitch('Tuesday'));
    fireEvent.change(screen.getByLabelText('Tuesday end'), { target: { value: '09:00' } });
    save();
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Tuesday: end time must be after start time.');
    });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('shows the server reason when saving fails', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('stripe onboarding incomplete'));
    renderCard();
    save();
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('stripe onboarding incomplete');
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('uses fallback copy when the failure carries no message', async () => {
    mutateAsync.mockRejectedValueOnce(null);
    renderCard();
    save();
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to update Instant availability');
    });
  });

  it('locks every control and shows a saving label while the request is in flight', () => {
    availabilityState.isPending = true;
    profileState.data = profile({ schedule: [{ day: 'mon', start_time: '09:00', end_time: '17:00' }] });
    renderCard();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Available now for Instant match' })).toBeDisabled();
    expect(daySwitch('Monday')).toBeDisabled();
    expect(screen.getByLabelText('Monday start')).toBeDisabled();
    expect(screen.getByLabelText('Monday end')).toBeDisabled();
  });
});
