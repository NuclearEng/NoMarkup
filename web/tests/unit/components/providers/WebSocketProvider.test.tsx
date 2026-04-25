import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WebSocketProvider } from '@/components/providers/WebSocketProvider';

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => undefined),
}));

describe('WebSocketProvider', () => {
  it('renders its children', () => {
    render(
      <WebSocketProvider>
        <div data-testid="child">hello</div>
      </WebSocketProvider>,
    );
    expect(screen.getByTestId('child').textContent).toBe('hello');
  });

  it('invokes useWebSocket on mount', async () => {
    const mod = await import('@/hooks/useWebSocket');
    const spy = vi.mocked(mod.useWebSocket);
    spy.mockClear();
    render(
      <WebSocketProvider>
        <span>x</span>
      </WebSocketProvider>,
    );
    expect(spy).toHaveBeenCalled();
  });
});
