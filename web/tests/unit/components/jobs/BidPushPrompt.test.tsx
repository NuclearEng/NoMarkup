import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
