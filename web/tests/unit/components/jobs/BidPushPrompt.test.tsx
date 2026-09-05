import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
const { toast } = await import('sonner');

// In-memory localStorage shim — jsdom default lacks bound methods.
const memoryStore = new Map<string, string>();
const memoryStorage: Storage = {
  get length(): number {
    return memoryStore.size;
  },
  clear: () => { memoryStore.clear(); },
  getItem: (key: string) => memoryStore.get(key) ?? null,
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  removeItem: (key: string) => { memoryStore.delete(key); },
  setItem: (key: string, value: string) => { memoryStore.set(key, value); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
});

// Stub the Notification API surface so the component sees default permission.
const MockNotification = {
  permission: 'default' as NotificationPermission,
  requestPermission: vi.fn(() => Promise.resolve('granted' as NotificationPermission)),
};
Object.defineProperty(globalThis, 'Notification', {
  value: MockNotification,
  writable: true,
  configurable: true,
});

import { BidPushPrompt } from '@/components/jobs/BidPushPrompt';

describe('BidPushPrompt', () => {
  beforeEach(() => {
    memoryStorage.clear();
    MockNotification.permission = 'default';
    MockNotification.requestPermission.mockClear();
    vi.mocked(toast.success).mockClear();
  });

  afterEach(() => {
    memoryStorage.clear();
  });

  it('renders nothing when user is not the job owner', () => {
    const { container } = render(
      <BidPushPrompt jobId="job-1" isJobOwner={false} bidCount={0} status="active" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when bids already exist', () => {
    const { container } = render(
      <BidPushPrompt jobId="job-1" isJobOwner bidCount={3} status="active" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when status is not active', () => {
    const { container } = render(
      <BidPushPrompt jobId="job-1" isJobOwner bidCount={0} status="closed" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders prompt when all conditions are met', () => {
    render(<BidPushPrompt jobId="job-1" isJobOwner bidCount={0} status="active" />);
    expect(screen.getByText('Get notified when bids come in')).toBeDefined();
    expect(screen.getByText('Enable Notifications')).toBeDefined();
  });

  it('respects pre-existing localStorage prompt flag', () => {
    memoryStorage.setItem('nm_push_prompted_job-9', 'true');
    const { container } = render(
      <BidPushPrompt jobId="job-9" isJobOwner bidCount={0} status="active" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render when notification permission is already granted', () => {
    MockNotification.permission = 'granted';
    const { container } = render(
      <BidPushPrompt jobId="job-2" isJobOwner bidCount={0} status="active" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render when notification permission has been denied', () => {
    MockNotification.permission = 'denied';
    const { container } = render(
      <BidPushPrompt jobId="job-3" isJobOwner bidCount={0} status="active" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('clicking Enable Notifications stores the prompt flag and requests permission', async () => {
    render(<BidPushPrompt jobId="job-4" isJobOwner bidCount={0} status="active" />);
    const btn = screen.getByRole('button', { name: /Enable Notifications/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    });
    expect(memoryStorage.getItem('nm_push_prompted_job-4')).toBe('true');
  });

  it('shows a success toast when permission is granted', async () => {
    MockNotification.requestPermission.mockResolvedValueOnce(
      'granted' as NotificationPermission,
    );
    render(<BidPushPrompt jobId="job-5" isJobOwner bidCount={0} status="active" />);
    fireEvent.click(screen.getByRole('button', { name: /Enable Notifications/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it('does not toast on denied permission', async () => {
    MockNotification.requestPermission.mockResolvedValueOnce(
      'denied' as NotificationPermission,
    );
    render(<BidPushPrompt jobId="job-6" isJobOwner bidCount={0} status="active" />);
    fireEvent.click(screen.getByRole('button', { name: /Enable Notifications/i }));
    await waitFor(() => {
      expect(MockNotification.requestPermission).toHaveBeenCalled();
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('hides the prompt immediately when Enable is clicked', async () => {
    const { container } = render(
      <BidPushPrompt jobId="job-7" isJobOwner bidCount={0} status="active" />,
    );
    expect(container.firstChild).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Enable Notifications/i }));
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('forwards className prop on the prompt card', () => {
    const { container } = render(
      <BidPushPrompt
        jobId="job-8"
        isJobOwner
        bidCount={0}
        status="active"
        className="custom-prompt"
      />,
    );
    expect(container.querySelector('.custom-prompt')).not.toBeNull();
  });
});
