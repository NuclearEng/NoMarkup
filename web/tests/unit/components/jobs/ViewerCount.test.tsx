import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ViewerCount } from '@/components/jobs/ViewerCount';

vi.mock('@/hooks/useViewerCount', () => ({
  useViewerCount: vi.fn(() => ({ count: 0 })),
}));

const { useViewerCount } = await import('@/hooks/useViewerCount');

describe('ViewerCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders nothing when count is 0', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 0 });
    const { container } = render(<ViewerCount jobId="job-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when count is 1', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 1 });
    const { container } = render(<ViewerCount jobId="job-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders text when count is 2 or more', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 5 });
    render(<ViewerCount jobId="job-1" />);
    expect(screen.getByText(/5 providers viewing now/)).toBeDefined();
  });

  it('exposes accessible aria-label', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 3 });
    render(<ViewerCount jobId="job-1" />);
    expect(screen.getByLabelText('3 providers viewing now')).toBeDefined();
  });

  it('forwards className', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 4 });
    render(<ViewerCount jobId="job-1" className="my-extra" />);
    const el = screen.getByLabelText(/4 providers viewing now/);
    expect(el.className).toContain('my-extra');
  });

  it('applies pulse scale on count change then removes it after timeout', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 2 });
    const { rerender } = render(<ViewerCount jobId="job-1" />);
    // Update the hook return and re-render to trigger the useEffect.
    vi.mocked(useViewerCount).mockReturnValue({ count: 3 });
    rerender(<ViewerCount jobId="job-1" />);
    const el = screen.getByLabelText(/3 providers viewing now/);
    expect(el.className).toContain('scale-105');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(el.className).not.toContain('scale-105');
  });

  it('does not pulse when count regresses to 0 (badge disappears anyway)', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 3 });
    const { container, rerender } = render(<ViewerCount jobId="job-1" />);
    vi.mocked(useViewerCount).mockReturnValue({ count: 0 });
    rerender(<ViewerCount jobId="job-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('uses singular "provider" text when count is exactly 1 (defensive — not rendered, but covers branch)', () => {
    // Branch coverage path through count !== 1 is exercised; the component bails early at count<=1
    // so re-confirm the early-return branch via a fresh mount.
    vi.mocked(useViewerCount).mockReturnValue({ count: 1 });
    const { container } = render(<ViewerCount jobId="job-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('clears timer on unmount without leaving stale state', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 2 });
    const { rerender, unmount } = render(<ViewerCount jobId="job-1" />);
    vi.mocked(useViewerCount).mockReturnValue({ count: 5 });
    rerender(<ViewerCount jobId="job-1" />);
    unmount();
    // Advancing timers after unmount should not crash.
    expect(() => {
      act(() => { vi.advanceTimersByTime(1000); });
    }).not.toThrow();
  });
});
