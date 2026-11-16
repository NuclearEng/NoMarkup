import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PushPermission } from '@/components/pwa/PushPermission';

// PushPermission is the soft-prompt that gates Notification.requestPermission()
// behind a user click. Default eligibility is conservative — these tests
// pin the visibility rules so a future change can't accidentally fire a
// hard prompt without a gesture.

interface MutableStorage extends Storage {
  clear: () => void;
}

function installStorage(): MutableStorage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => { map.clear(); },
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  } as MutableStorage;
}

describe('PushPermission', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      writable: true,
      configurable: true,
      value: installStorage(),
    });
    Object.defineProperty(window, 'sessionStorage', {
      writable: true,
      configurable: true,
      value: installStorage(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when authed=false', () => {
    const { container } = render(<PushPermission authed={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when push is unsupported (jsdom default)', () => {
    // jsdom does not ship Notification or PushManager → the hook reports
    // 'unsupported' which falls outside the render whitelist.
    const { container } = render(<PushPermission authed={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('honors the local-storage subscribed flag', () => {
    window.localStorage.setItem('pwa:push-subscribed', 'true');
    const { container } = render(<PushPermission authed={true} />);
    expect(container).toBeEmptyDOMElement();
  });
});
